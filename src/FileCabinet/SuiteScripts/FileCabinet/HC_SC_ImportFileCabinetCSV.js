/**
 * Generic File Cabinet CSV import.
 *
 * Picks feed files out of a NetSuite File Cabinet folder and runs them through an existing saved
 * CSV import, then files each one under archive/ or failed/. It is the read half of the File
 * Cabinet transport: Moqui writes into the folder through HC_RL_UploadFileToCabinet, this takes
 * them out again. It replaces the per-feed SFTP poller (HC_importSalesOrders and friends) without
 * touching how the records themselves are created.
 *
 * The script is deliberately dumb and feed-agnostic. The folder and the saved import id are script
 * parameters, so a new feed is a new deployment rather than a new script. Because it reuses the
 * feed's existing saved import, the records it creates are identical to the ones the SFTP path
 * creates today - which is what makes SFTP and File Cabinet directly comparable during cutover.
 *
 * All mapping stays where it already lives: in Moqui, which builds the CSV, and in the saved
 * import, which maps the columns. Nothing here knows what a Sales Order is.
 *
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/file', 'N/record', 'N/search', 'N/task', 'N/runtime', 'N/error', 'N/compress'],
    function (file, record, search, task, runtime, error, compress) {

        // Leave enough units to finish the file in flight and file it away. A scheduled script that
        // dies mid-loop leaves a file it has already submitted still sitting in the inbox, which the
        // next run would submit a second time.
        var USAGE_THRESHOLD = 500;

        // Working folders, created on demand as children of the feed folder. Nested rather than
        // top-level on purpose: HC_RL_UploadFileToCabinet resolves folder names at the File Cabinet
        // root, so a root-level "archive" would be a single globally shared name that every feed
        // would fight over. Under the feed folder, two feeds can each have their own.
        var ARCHIVE_FOLDER = 'archive';
        var FAILED_FOLDER = 'failed';
        var ERROR_FOLDER = 'error';

        // Colons and spaces are legal in a File Cabinet name but make the files miserable to handle
        // anywhere else, so the ISO form is flattened.
        var timestamp = function () {
            return new Date().toISOString().replace(/[:.]/g, '-');
        };

        /**
         * Resolve the feed folder by name at the File Cabinet root.
         *
         * Scoped to the root for the same reason HC_RL_UploadFileToCabinet scopes its lookup there:
         * an unscoped name search matches a folder with that name anywhere in the cabinet, so the
         * feed could silently resolve to someone else's nested folder, and to a different one over
         * time as folders are added. Both sides must agree on where the name is looked up or the
         * writer and the reader end up in different folders.
         *
         * This deliberately does NOT create the folder. The upload side creates it, so by the time
         * a file exists it exists too. Creating it here would turn a mistyped folder parameter into
         * an empty folder that the script then polls forever, reporting success and importing
         * nothing - the failure mode that is hardest to notice.
         */
        var resolveFeedFolder = function (folderName) {
            var folderSearch = search.create({
                type: search.Type.FOLDER,
                filters: [
                    ['name', 'is', folderName],
                    'AND',
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['parent', 'anyof', '@NONE@']
                ],
                columns: ['internalid']
            });

            var matches = folderSearch.run().getRange({ start: 0, end: 2 });

            if (!matches.length) {
                throw error.create({
                    name: 'FEED_FOLDER_NOT_FOUND',
                    message: 'No active top-level File Cabinet folder named ' + folderName +
                        '. It is created by the upload RESTlet on first upload; check that the ' +
                        'folder parameter matches the folderName Moqui uploads with.'
                });
            }
            if (matches.length > 1) {
                throw error.create({
                    name: 'AMBIGUOUS_FOLDER_NAME',
                    message: 'More than one active top-level folder is named ' + folderName
                });
            }
            return matches[0].getValue('internalid');
        };

        var getOrCreateChildFolder = function (parentId, name) {
            var folderSearch = search.create({
                type: search.Type.FOLDER,
                filters: [
                    ['name', 'is', name],
                    'AND',
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['parent', 'anyof', parentId]
                ],
                columns: ['internalid']
            });

            var matches = folderSearch.run().getRange({ start: 0, end: 1 });
            if (matches.length) return matches[0].getValue('internalid');

            var folder = record.create({ type: record.Type.FOLDER });
            folder.setValue({ fieldId: 'name', value: name });
            folder.setValue({ fieldId: 'parent', value: parentId });
            var folderId = folder.save();
            log.audit('Created working folder', name + ' (' + folderId + ') under ' + parentId);
            return folderId;
        };

        /**
         * A File Cabinet move is a folder reassignment on the file record, not a copy plus delete,
         * so the internal id survives and anything already referencing the file still resolves.
         */
        var moveFile = function (fileId, targetFolderId, description) {
            var fileObj = file.load({ id: fileId });
            fileObj.folder = targetFolderId;
            if (description) fileObj.description = description;
            fileObj.save();
        };

        function execute(context) {
            var scriptObj = runtime.getCurrentScript();

            var readParam = function (name) {
                return (scriptObj.getParameter({ name: name }) || '').toString().trim();
            };

            var folderName = readParam('custscript_hc_fc_import_folder');
            var mappingId = readParam('custscript_hc_fc_import_mapping');
            var importLabel = readParam('custscript_hc_fc_import_label') || 'File Cabinet CSV Import';

            if (!folderName || !mappingId) {
                throw error.create({
                    name: 'MISSING_SCRIPT_PARAMETER',
                    message: 'Both the folder (custscript_hc_fc_import_folder) and the saved import ' +
                        'id (custscript_hc_fc_import_mapping) are required on the deployment'
                });
            }

            var feedFolderId = resolveFeedFolder(folderName);
            log.audit('File Cabinet import starting', 'folder: ' + folderName + ' (' + feedFolderId +
                '), saved import: ' + mappingId);

            // Working folders are resolved lazily so an ordinary clean run does not create a failed/
            // or error/ folder it never uses.
            var workingFolders = {};
            var workingFolder = function (name) {
                if (!workingFolders[name]) workingFolders[name] = getOrCreateChildFolder(feedFolderId, name);
                return workingFolders[name];
            };

            // Collected before processing rather than iterated live: every file is moved out of this
            // folder as it is handled, and mutating the folder a search is still paging over is how
            // rows get skipped.
            var pending = [];
            search.create({
                // The string form rather than search.Type.FILE, matching the other File Cabinet
                // searches in this repo.
                type: 'file',
                // anyof on folder is an exact-parent match, so archive/, failed/ and error/ are not
                // re-read on the next run.
                filters: [['folder', 'anyof', feedFolderId]],
                columns: [
                    'name',
                    // Oldest first, so a feed that uploaded twice is imported in the order it was
                    // produced. Mirrors sftp.Sort.DATE on the transport this replaces.
                    search.createColumn({ name: 'modified', sort: search.Sort.ASC })
                ]
            }).run().each(function (result) {
                pending.push({ id: result.id, name: result.getValue('name') });
                return true;
            });

            log.audit('Files awaiting import', pending.length);

            for (var i = 0; i < pending.length; i++) {
                if (scriptObj.getRemainingUsage() < USAGE_THRESHOLD) {
                    log.audit('Yielding: usage threshold reached',
                        (pending.length - i) + ' file(s) left for the next run');
                    return;
                }

                var entry = pending[i];

                // Only feed files. Anything else a person has dropped in the folder is left alone
                // rather than pushed through a CSV import that would fail on it.
                if (!/\.csv(\.gz)?$/i.test(entry.name)) {
                    log.debug('Skipping non-CSV file', entry.name);
                    continue;
                }

                try {
                    var importFile = file.load({ id: entry.id });

                    // Emptiness is tested on the loaded File, whose size is in BYTES. The file
                    // search's documentsize column reports KILOBYTES, so a small but perfectly valid
                    // feed rounds to 0 there and would be archived without ever being imported -
                    // a silent loss that logs as a clean run.
                    if (importFile.size === 0) {
                        moveFile(entry.id, workingFolder(ARCHIVE_FOLDER), 'Empty file, no import submitted');
                        log.audit('Empty file archived without import', entry.name);
                        continue;
                    }

                    // Compressed feeds. Moqui sends the Sales Order feed uncompressed today, so this
                    // branch is UNVERIFIED against a live account - gunzip returns an unsaved temp
                    // file whose type NetSuite infers, and whether CSV_IMPORT accepts it directly has
                    // not been observed. It is wired up because the epic moves to gzip and the
                    // failure is contained: a rejection lands the file in failed/ with the real
                    // NetSuite error, exactly like any other bad file.
                    if (/\.gz$/i.test(entry.name)) {
                        importFile = compress.gunzip({ file: importFile });
                        log.debug('Decompressed before import', entry.name);
                    }

                    var importTask = task.create({ taskType: task.TaskType.CSV_IMPORT });
                    importTask.mappingId = mappingId;
                    importTask.importFile = importFile;
                    importTask.name = importLabel + ' - ' + entry.name;

                    var taskId = importTask.submit();

                    // This is the status of the SUBMISSION, not of the import. A CSV import is queued,
                    // so a check this early reads PENDING in the normal case and only ever catches an
                    // immediate rejection. Row-level outcomes are not visible here at all - they live
                    // in the import job's own status page, and tracking them from the OMS is what
                    // mantle-netsuite-connector#316 exists for. The task id is recorded on the
                    // archived file so a run can still be traced back to its import.
                    var status = task.checkStatus({ taskId: taskId }).status;

                    if (status === task.TaskStatus.FAILED) {
                        throw error.create({
                            name: 'CSV_IMPORT_SUBMIT_FAILED',
                            message: 'CSV import task ' + taskId + ' was rejected on submission'
                        });
                    }

                    moveFile(entry.id, workingFolder(ARCHIVE_FOLDER), 'csvImportTaskId=' + taskId);
                    log.audit('CSV import submitted',
                        'file: ' + entry.name + ', taskId: ' + taskId + ', status: ' + status);

                } catch (e) {
                    log.error({ title: 'Failed to import ' + entry.name + ' from the File Cabinet', details: e });

                    // Written per file rather than accumulated, so a run that dies partway still
                    // leaves a record for everything it had already failed.
                    try {
                        file.create({
                            name: timestamp() + '-error-' + entry.name.replace(/\.csv(\.gz)?$/i, '') + '.csv',
                            fileType: file.Type.CSV,
                            contents: 'fileName,errorMessage\n' +
                                entry.name + ',"' + String(e.message || e).replace(/"/g, '""') + '"\n',
                            folder: workingFolder(ERROR_FOLDER)
                        }).save();

                        moveFile(entry.id, workingFolder(FAILED_FOLDER), 'See error/ for the failure detail');
                    } catch (fileErr) {
                        // The file stays in the inbox and will be retried next run. Logged loudly
                        // because a file that cannot be moved is a file that imports twice.
                        log.error({
                            title: 'Could not quarantine ' + entry.name + '; it remains in the inbox',
                            details: fileErr
                        });
                    }
                }
            }

            log.audit('File Cabinet import finished', 'folder: ' + folderName);
        }

        return { execute: execute };
    });
