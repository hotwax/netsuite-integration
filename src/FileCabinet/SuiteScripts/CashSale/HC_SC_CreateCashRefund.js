/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */

define(['N/sftp', 'N/record', 'N/error', 'N/search', 'N/file'], function (sftp, record, error, search, file) {

    function execute(context) {
        try {
            // Establish a connection to a remote FTP server
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

            sftpDirectory = sftpDirectory + 'cashsale/return';
            sftpPort = parseInt(sftpPort);

            var connection = sftp.createConnection({
                username: sftpUserName,
                keyId: sftpKeyId,
                url: sftpUrl,
                port: sftpPort,
                directory: sftpDirectory,
                hostKey: hostKey
            });

            log.debug("Connection established successfully with SFTP server!");

            var list = connection.list({
                path: '/'
            });

            for (var i = 0; i < list.length; i++) {
                if (!list[i].directory) {
                    var fileName = list[i].name;
                    // Download the file from the remote server
                    var downloadedFile = connection.download({
                        directory: '/',
                        filename: fileName
                    });

                    if (downloadedFile.size > 0) {
                        log.debug("File downloaded successfully !" + fileName);
                        var contents = downloadedFile.getContents();

                        // Parse the Return Authorization JSON file
                        var cashRefundDataList = JSON.parse(contents);
                        var errorList = [];

                        for (var dataIndex = 0; dataIndex < cashRefundDataList.length; dataIndex++) {
                            var orderId = cashRefundDataList[dataIndex].order_id;
                            var itemList = cashRefundDataList[dataIndex].items;

                            try {
                                if (orderId) {
                                    // Initialize Return Authorization from Sales Order
                                    var cashRefundRecord = record.transform({
                                        fromType: record.Type.CASH_SALE,
                                        fromId: orderId,
                                        toType: record.Type.CASH_REFUND,
                                        isDynamic: true
                                    });

                                    var lineCount = cashRefundRecord.getLineCount({
                                        sublistId: 'item'
                                    });

                                    var removeListline = [];

                                    for (var j = 0; j < lineCount; j++) {
                                        var matchFound = false;

                                        var itemid = cashRefundRecord.getSublistValue({
                                            sublistId: 'item',
                                            fieldId: 'item',
                                            line: j
                                        });

                                        var externallineid = cashRefundRecord.getSublistValue({
                                            sublistId: 'item',
                                            fieldId: 'custcol_hc_order_line_id',
                                            line: j
                                        });

                                        for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                                            var productId = itemList[itemIndex].product_id;
                                            var returnquantity = itemList[itemIndex].quantity;
                                            var returnamount = itemList[itemIndex].amount;
                                            var returnlineid = itemList[itemIndex].external_order_line_id;
                                            var locationid = itemList[itemIndex].location_id;

                                            // If return item match with sales order item
                                            if (productId === itemid && returnlineid === externallineid) {
                                                matchFound = true;

                                                cashRefundRecord.selectLine({
                                                    sublistId: 'item',
                                                    line: j
                                                });

                                                cashRefundRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'quantity',
                                                    value: returnquantity
                                                });

                                                // Custom price level
                                                cashRefundRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'price',
                                                    value: "-1"
                                                });

                                                cashRefundRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'amount',
                                                    value: returnamount
                                                });

                                                cashRefundRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'location',
                                                    value: locationid
                                                });

                                                cashRefundRecord.commitLine({
                                                    sublistId: 'item'
                                                });
                                            }
                                        }
                                        if (!matchFound) {
                                            removeListline.push(j);
                                        }
                                    }
                                    // Remove line item are not in return
                                    if (removeListline.length > 0) {
                                        for (var k = removeListline.length - 1; k >= 0; k--) {
                                            var removeitem = removeListline[k]
                                            cashRefundRecord.removeLine({
                                                sublistId: 'item',
                                                line: removeitem
                                            });
                                        }
                                    }
                                    // Save the Cash refund
                                    var cashRefundId = cashRefundRecord.save();

                                    log.debug("Cash refund created for Cash sale with ID: " + orderId + ", Cash refund ID: " + cashRefundId);
                                }
                            } catch (e) {
                                log.error({
                                    title: 'Error in processing Cash sales order ' + orderId,
                                    details: e
                                });
                                var errorInfo = orderId + ',' + e.message + '\n';
                                errorList.push(errorInfo);
                            }
                        }
                        // Archive the file
                        connection.move({
                            from: '/' + fileName,
                            to: '/archive/' + fileName
                        });

                        log.debug('File moved!' + fileName);

                        if (errorList.length !== 0) {
                            var fileLines = 'orderId,errorMessage\n';
                            fileLines = fileLines + errorList;
                            
                            var date = new Date();
                            var errorFileName = date + '-ErrorCashSaleReturn.csv';
                            var fileObj = file.create({
                                name: errorFileName,
                                fileType: file.Type.CSV,
                                contents: fileLines
                            });

                            connection.upload({
                                directory: '/error/',
                                file: fileObj
                            });
                        }
                    }
                }
            }
        } catch (e) {
            log.error({
                title: 'Error in creating Cash refund',
                details: e
            });
            throw error.create({
                name: "Error in creating Cash refund",
                message: e
            });
        }
    }
    return {
        execute: execute
    };
});