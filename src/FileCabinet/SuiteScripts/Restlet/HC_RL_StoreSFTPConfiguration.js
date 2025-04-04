/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record'],
    ( record) => {
        const post = (requestBody) => {
            var hostName = requestBody.hostName;
            var userName = requestBody.userName;
            var port = requestBody.port;
            var hostKey = requestBody.hostKey;
            var defaultDirectory = requestBody.defaultDirectory;
            var secretId = requestBody.secretId;

            // save sftp configuration
            var sftpConfigRecord = record.create({
                type: 'customrecord_ns_sftp_configuration',
                isDynamic: false
            });

            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_server', value: hostName });
            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_userid', value: userName });
            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_port_no', value: port });
            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_host_key', value: hostKey });
            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_guid', value: secretId });
            sftpConfigRecord.setValue({ fieldId: 'custrecord_ns_sftp_default_file_dir', value: defaultDirectory });

            var recordId = sftpConfigRecord.save();
            log.debug('SFTP Configuration Saved', 'Record ID: ' + recordId);

            return {
                status: 'success',
                message: 'SFTP Configuration is added successfully'
            };
        }
        return {post}
    });
