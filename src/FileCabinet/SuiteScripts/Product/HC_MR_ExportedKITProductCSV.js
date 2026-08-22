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

            mapContext.write({
                key: kitName,
                value: {
                    'idValue': memberItemId,
                    'quantity': quantity
                }
            });

        }

        const reduce = (reduceContext) => {
            var kitName = reduceContext.key;
            var productAssocList = reduceContext.values.map((value) => JSON.parse(value));
            var kitProductAssocData = {
                'productId': kitName,
                'idType': 'SKU',
                'productAssocTypeId': 'PRODUCT_COMPONENT',
                'productAssocList': productAssocList
            };
            reduceContext.write(kitName, JSON.stringify(kitProductAssocData));
        }

        const summarize = (summaryContext) => {
            try {
                var records = [];
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    records.push(JSON.parse(value));
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {
                    var pad = function(num, size) { return ('000' + num).slice(-size); };
                    var dateCreated = new Date(summaryContext.dateCreated);
                    var formattedDate = dateCreated.getFullYear() + '-' + pad(dateCreated.getMonth() + 1, 2) + '-' +
                        pad(dateCreated.getDate(), 2) + '-' + pad(dateCreated.getHours(), 2) + '_' +
                        pad(dateCreated.getMinutes(), 2) + '_' + pad(dateCreated.getSeconds(), 2) + '_' +
                        pad(dateCreated.getMilliseconds(), 3);
                    var fileName = 'KITProductExport_' + formattedDate + '.json';

                    var kitItemFileObj = file.create({
                        name: fileName,
                        fileType: file.Type.JSON,
                        contents: JSON.stringify(records)
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
                        directory: '/kit/',
                        file: kitItemFileObj
                    });
                    log.debug("KIT Item JSON File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading kit item json files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading kit item json files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });
