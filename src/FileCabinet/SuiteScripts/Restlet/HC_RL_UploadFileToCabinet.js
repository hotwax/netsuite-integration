/**
 * Generic File Cabinet upload RESTlet.
 *
 * Moqui posts a base64 payload, this saves it as a File Cabinet file and returns the internal id.
 * It does no mapping and no business logic. All feed logic stays in Moqui.
 *
 * The caller owns the file name. A save with a name that already exists in the target folder
 * REPLACES that file, so callers must make names unique.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file', 'N/record', 'N/search', 'N/encode', 'N/error'],
    (file, record, search, encode, error) => {

        // File types whose contents must stay base64. Everything else is decoded to UTF-8 text.
        // Add a type here before sending it, or the file will be written as text and corrupted.
        const BINARY_TYPES = ['MISCBINARY', 'ZIP', 'PDF'];

        // folderName always identifies a TOP-LEVEL File Cabinet folder. Lookup and creation are scoped to
        // the same place deliberately: an unscoped name search matches a folder with that name anywhere in
        // the cabinet, so a feed could resolve to someone else's nested folder and, worse, resolve to a
        // different one as folders are added. Root-level scoping makes the name unambiguous.
        // Pass folder (the internal id) instead when the target is nested.
        const getOrCreateFolder = (folderName) => {
            var folderSearch = search.create({
                type: search.Type.FOLDER,
                filters: [
                    ['name', 'is', folderName],
                    'AND',
                    // An inactive folder still matches a name search but cannot receive files.
                    ['isinactive', 'is', 'F'],
                    'AND',
                    // @NONE@ is the File Cabinet root; without this the match is cabinet-wide.
                    ['parent', 'anyof', '@NONE@']
                ],
                columns: ['internalid']
            });

            var matches = folderSearch.run().getRange({ start: 0, end: 2 });
            // Two active root folders cannot share a name in NetSuite, so this is defensive rather than
            // expected - but picking arbitrarily is how files end up somewhere nobody looks.
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
                // Explicit empty parent = create at the root, matching where the search just looked.
                // Left unset the folder still lands at the root, but only by default rather than by intent.
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

            // Binary types keep the base64 payload, N/file decodes it. Text types must be decoded here,
            // otherwise the base64 string itself is written as the file body.
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
