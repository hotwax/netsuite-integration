/**
 * Saves a base64 body as a File Cabinet file; answers the file id. A same-named file in the folder is replaced.
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file', 'N/record', 'N/search', 'N/encode', 'N/error', 'N/log'],
    (file, record, search, encode, error, log) => {

        // file.Type keys sent as base64; every other type is decoded to UTF-8 text
        const BINARY_TYPES = ['GZIP', 'ZIP', 'PDF', 'TAR'];

        // folderName is a top-level folder; pass folder (the internal id) for a nested one
        const getOrCreateFolder = (folderName) => {
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
            if (matches.length > 1) {
                throw error.create({
                    name: 'AMBIGUOUS_FOLDER_NAME',
                    message: 'More than one active top-level folder is named ' + folderName +
                        '; pass the folder internal id instead'
                });
            }

            var folderId = matches.length ? matches[0].getValue('internalid') : null;

            if (!folderId) {
                var folder = record.create({ type: record.Type.FOLDER });
                folder.setValue({ fieldId: 'name', value: folderName });
                folder.setValue({ fieldId: 'parent', value: '' });
                folderId = folder.save();
                log.debug('Created folder: ' + folderName);
            }
            return folderId;
        };

        const post = (requestBody) => {
            var name = requestBody.name;
            var fileType = requestBody.fileType;
            var contents = requestBody.contents;
            var folderId = requestBody.folder;
            var folderName = requestBody.folderName;

            if (!name || !contents) {
                throw error.create({
                    name: 'MISSING_REQUIRED_PARAM',
                    message: 'Both name and contents are required to upload a file'
                });
            }
            if (!folderId && !folderName) {
                throw error.create({
                    name: 'MISSING_REQUIRED_PARAM',
                    message: 'Either folder or folderName is required to upload a file'
                });
            }

            var resolvedType = file.Type[fileType];
            if (!resolvedType) {
                throw error.create({
                    name: 'UNSUPPORTED_FILE_TYPE',
                    message: 'Unsupported fileType ' + fileType
                });
            }

            var fileContents = contents;
            if (BINARY_TYPES.indexOf(fileType) === -1) {
                fileContents = encode.convert({
                    string: contents,
                    inputEncoding: encode.Encoding.BASE_64,
                    outputEncoding: encode.Encoding.UTF_8
                });
            }

            if (!folderId) folderId = getOrCreateFolder(folderName);

            var fileObj = file.create({
                name: name,
                fileType: resolvedType,
                contents: fileContents,
                folder: folderId
            });

            var fileId = fileObj.save();
            log.debug('File saved to File Cabinet', 'name: ' + name + ', id: ' + fileId + ', folder: ' + folderId);

            return {
                status: 'success',
                fileId: fileId,
                fileName: name,
                folderId: folderId
            };
        };

        return { post };
    });
