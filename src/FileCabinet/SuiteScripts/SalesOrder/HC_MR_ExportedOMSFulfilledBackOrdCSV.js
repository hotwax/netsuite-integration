/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/search', 'N/sftp', 'N/error'],
    (file, search, sftp, error) => {
        const getInputData = (inputContext) => {
            return search.load({ id: 'customsearch_hc_exp_oms_shipped_orders' });
        };

        const map = (mapContext) => {
            // Parse the context value
            var contextValues = JSON.parse(mapContext.value);

            var orderId = contextValues.values.internalid.value;
            var lineId = contextValues.values.line;
            var locationInternalId = contextValues.values.location.value;
            var quantity = contextValues.values.quantity;
            var shippingMethod = contextValues.values.shipmethod.text;

            var shipmentData = {
                'orderId': orderId,
                'lineId': lineId,
                'locationInternalId': locationInternalId,
                'quantity': quantity,
                'shipmentMethod': shippingMethod
            };

            mapContext.write({
                key: contextValues.id + '-' + lineId,
                value: shipmentData
            }); 
        };

        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var shipmentId = reduceContext.key; 
            
            var content = contextValues.orderId + ',' + contextValues.lineId + ',' + contextValues.locationInternalId + ',' + contextValues.quantity + ',' + contextValues.shipmentMethod + '\n';
            reduceContext.write(shipmentId, content);
        }

        const summarize = (summaryContext) => {
            try {
                var fileLines = 'orderId,lineId,locationInternalId,quantity,shipmentMethodTypeId\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName = summaryContext.dateCreated + '-OMS_Fulfilled_SalesOrderFulfillment.csv';
                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });
                    try {
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

                        sftpDirectory = sftpDirectory + 'salesorder';
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
            
                        if (fileObj.size > connection.MAX_FILE_SIZE) {
                            throw error.create({
                                name: "FILE_IS_TOO_BIG",
                                message: "The file you are trying to upload is too big"
                            });
                        }
                        connection.upload({
                            directory: '/import/oms-fulfillment-nifi/',
                            file: fileObj
                        });
                        log.debug("OMS Sales Order Fulfillment CSV File Uploaded Successfully to SFTP server with file" + fileName);
                    } catch (e) {
                        log.error({
                            title: 'Error in exporting and uploading oms sales order fulfillment csv files',
                            details: e,
                        });
                        throw error.create({
                            name: "Error in exporting and uploading oms sales order fulfillment csv files",
                            message: e
                        });
                    }
                }
            } catch (e) {
                log.error({
                    title: 'Error in exporting and uploading oms sales order fulfillment csv files',
                    details: e,
                });
            } 
        }

        return { getInputData, map, reduce,summarize };
    });