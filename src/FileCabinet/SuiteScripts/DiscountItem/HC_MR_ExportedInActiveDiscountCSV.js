/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/search', 'N/sftp', 'N/error'],
    (file, search, sftp, error) => {
        const getInputData = (inputContext) => {
            
            var discountItemSearch = search.load({ id: 'customsearch_hc_export_inactive_discount' });
            return discountItemSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var discountName = contextValues.values.itemid;
            var internalId = contextValues.values.internalid.value;

            var discountdata = {
                'internalId': internalId,
                'discountName': discountName
            };
            mapContext.write({
                key: contextValues.id,
                value: discountdata
            });
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var keyId = reduceContext.key; 

            var content = contextValues.internalId + ',' + contextValues.discountName + '\n';
            reduceContext.write(keyId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'productPromoId,promoName\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {
                    var fileName =  summaryContext.dateCreated + '-InActiveDiscountItemExport.csv';

                    var discountItemFileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

                    // Establish a connection to a remote FTP server
                    /* The host key can be obtained using OpenSSH's ssh-keyscan tool:
                    ssh-keyscan -t <hostKeyType> -p <port> <hostDomain>
                    Example: ssh-keyscan -t ECDSA -p 235 hc-uat.hotwax.io 
                    */

                    //Get Custom Record Type SFTP details
                    var customRecordSFTPSearch = search.create({
                        type: 'customrecord_ns_sftp_configuration',
                        columns: [
                            'custrecord_ns_sftp_server',
                            'custrecord_ns_sftp_userid',
                            'custrecord_ns_sftp_port_no',
                            'custrecord_ns_sftp_host_key',
                            'custrecord_ns_sftp_guid',
                            'custrecord_ns_sftp_default_file_dir'
                        ]
                        
                    });
                    var sftpSearchResults = customRecordSFTPSearch.run().getRange({
                        start: 0,
                        end: 1
                    });
               
                    var sftpSearchResult = sftpSearchResults[0];
                    
                    var sftpUrl = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_server'
                    });

                    var sftpUserName = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_userid'
                    });

                    var sftpPort = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_port_no'
                    });

                    var hostKey = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_host_key'
                    });
                    
                    var sftpKeyId = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_guid'
                    });

                    var sftpDirectory = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_default_file_dir'
                    });

                    sftpDirectory = sftpDirectory + 'discountitem';
                    sftpPort = parseInt(sftpPort);
        
                    var connection = sftp.createConnection({
                        username: sftpUserName,
                        secret: sftpKeyId,
                        url: sftpUrl,
                        port: sftpPort,
                        directory: sftpDirectory,
                        hostKey: hostKey
                    });
                    log.debug("Connection established successfully with SFTP server!");
            
                    if (discountItemFileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                        name:"FILE_IS_TOO_BIG",
                        message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/delete/',
                        file: discountItemFileObj
                    });
                    log.debug("Inactive Discount Item CSV File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading inactive discount item csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading inactive discount item csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });