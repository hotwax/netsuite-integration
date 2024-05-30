/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/search', 'N/sftp', 'N/error'],
    (file, search, sftp, error) => {
        const getInputData = (inputContext) => {
            
            var kitItemSearch = search.load({ id: 'customsearch_hc_exp_kit_component' });
            return kitItemSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var memberItemId = contextValues.values.memberitem.text;
            var kitName = contextValues.values.itemid;
            var quantity = contextValues.values.memberquantity; 

            var kitProductData = {
                'productId': kitName,
                'productIdTo': memberItemId,
                'quantity': quantity,
                'productAssocTypeId': 'PRODUCT_COMPONENT'
            };
            mapContext.write({
                key: contextValues.id + '-' + memberItemId,
                value: kitProductData
            });
            
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var keyId = reduceContext.key; 

            var content = contextValues.productId + ',' + contextValues.productIdTo + ',' + contextValues.quantity + ',' + contextValues.productAssocTypeId + '\n';
            reduceContext.write(keyId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'productId,productIdTo,quantity,productAssocTypeId\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {
                    var fileName =  summaryContext.dateCreated + '-KITProductExport.csv';

                    var kitItemFileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

                    
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

                    sftpDirectory = sftpDirectory + 'product';
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
            
                    if (kitItemFileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                        name:"FILE_IS_TOO_BIG",
                        message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/kit-nifi/',
                        file: kitItemFileObj
                    });
                    log.debug("KIT Item CSV File Uploaded Successfully to SFTP server with file" + fileName);
                    
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading kit item csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading kit item csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });