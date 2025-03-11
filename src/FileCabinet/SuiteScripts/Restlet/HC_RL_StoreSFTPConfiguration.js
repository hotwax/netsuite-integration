/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search'],
    ( record, search) => {
        const post = (requestBody) => {
            var hostName = requestBody.hostName;
            var userName = requestBody.userName;
            var port = requestBody.port;
            var hostKey = requestBody.hostKey;
            var defaultDirectory = requestBody.defaultDirectory;
            var secretId = requestBody.secretId;

            //Get SFTP Configuration Custom Record internal id
            var customRecordHCExSearch = search.create({
                type: 'customrecord_ns_sftp_configuration',
                columns: ['internalid']
            });
            var searchResults = customRecordHCExSearch.run().getRange({
                start: 0,
                end: 1
            });
        
            var searchResult = searchResults[0];
            var sftpConfigurationInternalId = searchResult.getValue({
                name: 'internalid'
            });

            // save sftp configuration
            record.submitFields({
                type: 'customrecord_ns_sftp_configuration',
                id: sftpConfigurationInternalId,
                values: {
                    custrecord_ns_sftp_server : hostName,
                    custrecord_ns_sftp_userid : userName,
                    custrecord_ns_sftp_port_no : port,
                    custrecord_ns_sftp_host_key : hostKey,
                    custrecord_ns_sftp_guid : secretId,
                    custrecord_ns_sftp_default_file_dir : defaultDirectory
                }
            });

            
            return {
                status: 'success',
                message: 'SFTP Configuration is added successfully'
            };
        }
        return {post}
    });
