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

        const getOrCreateFolder = (folderName) => {
            var folderSearch = search.create({
                type: search.Type.FOLDER,
                filters: [['name', 'is', folderName]],
                columns: ['internalid']
            });

            var folderId = folderSearch.run().getRange({ start: 0, end: 1 })
                .map(function (result) {
                    return result.getValue('internalid');
                })[0];

            if (!folderId) {
                var folder = record.create({ type: record.Type.FOLDER });
                folder.setValue({ fieldId: 'name', value: folderName });
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
