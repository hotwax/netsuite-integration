/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
*/

define(['N/sftp', 'N/record', 'N/error', 'N/search', 'N/file', 'N/runtime'], function (sftp, record, error, search, file, runtime) {

    function execute(context) {
        try {
            var usageThreshold = 500; // Set a threshold for remaining usage units
            var scriptObj = runtime.getCurrentScript();

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

            sftpDirectory = sftpDirectory + 'transferorderv2/receipt';
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
                path: '/',
                sort: sftp.Sort.DATE
            });

            for (var i = 0; i < list.length; i++) {
                if (!list[i].directory) {
                    if (scriptObj.getRemainingUsage() < usageThreshold) {
                        log.debug('Scheduled script has exceeded the usage unit threshold.');
                        return;
                    }
                    var fileName = list[i].name;

                    // Download the file from the remote server
                    var downloadedFile = connection.download({
                        directory: '/',
                        filename: fileName
                    });
                    if (downloadedFile.size > 0) {
                        log.debug("File downloaded successfully !" + fileName);
                        var contents = downloadedFile.getContents();

                        //Parse the Transfer ItemReceipt JSON file
                        var transferOrderDataList = JSON.parse(contents);
                        var errorList = [];

                        for (var dataIndex = 0; dataIndex < transferOrderDataList.length; dataIndex++) {
                            var orderId = transferOrderDataList[dataIndex].order_id;
                            var itemList = transferOrderDataList[dataIndex].items;
                            var itemFulfillment = {}; // Object to group items by fulfillmentId

                            try {
                                if (orderId) {
                                    log.debug("===========orderId==" + orderId);
                                    for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                                        var orderLine = Number(itemList[itemIndex].line_id) + 1;
                                        orderLine = orderLine.toString();

                                        const fulfillmentSearch = search.create({
                                            type: search.Type.ITEM_FULFILLMENT,
                                            filters: [
                                                ['createdfrom.internalId', 'is', orderId],
                                                'and',
                                                ['mainline', 'is', true]

                                            ],
                                            columns: ['internalid']
                                        });
                                        
                                        const transferOrderSearch = search.create({
                                            type: search.Type.ITEM_FULFILLMENT,
                                            filters: [
                                                ['internalId', 'is', orderId],
                                                'and',
                                                ['mainline', 'is', true]

                                            ],
                                            columns: ['internalid']
                                        });

                                        const transferOrderSerchResult = transferOrderSearch.run().getRange({ start: 0, end: 1000 });                                        ;

                                        for (let i = 0; i < searchResults.length; i++) {
                                            let fulfillmentId = searchResults[i].getValue({ name: 'internalid' });

                                            let fulfillmentRec = record.load({
                                                type: record.Type.ITEM_FULFILLMENT,
                                                id: fulfillmentId
                                            });

                                            let lineCount = fulfillmentRec.getLineCount({ sublistId: 'item' });
                                            for (let j = 0; j < lineCount; j++) {
                                                let orderline = fulfillmentRec.getSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'orderline',
                                                    line: j
                                                });

                                                if (orderline && orderline === orderLine) {
                                                    log.debug('==Matching fulfillment found:==', fulfillmentId);
                                                    itemList[itemIndex].fulfillmentId = fulfillmentId;

                                                    if (!itemFulfillment[fulfillmentId]) {
                                                        itemFulfillment[fulfillmentId] = [];
                                                    }
                                                    itemFulfillment[fulfillmentId].push(itemList[itemIndex]);
                                                }
                                            }
                                        }

                                    }
                                    for (var fulfillmentId in itemFulfillment) {
                                        var fulfillmentItems = itemFulfillment[fulfillmentId];
                                        log.debug("===========fulfillmentId==" + fulfillmentId);

                                        // Initilize ItemReceipt Object from TransferOrder
                                        var itemReceiptRecord = record.transform({
                                            fromType: record.Type.TRANSFER_ORDER,
                                            fromId: orderId,
                                            toType: record.Type.ITEM_RECEIPT,
                                            defaultValues: {
                                                itemfulfillment: fulfillmentId
                                            }
                                        });
                                        // set memo
                                        itemReceiptRecord.setValue({
                                            fieldId: 'memo',
                                            value: 'Item Receipt created by HotWax'
                                        });

                                        for (var itemIndex = 0; itemIndex < fulfillmentItems.length; itemIndex++) {
                                            var lineId = Number(fulfillmentItems[itemIndex].line_id) + 2;
                                            lineId = lineId.toString();

                                            var quantity = fulfillmentItems[itemIndex].quantity;
                                            log.debug("====lineId====" + lineId );
                                            log.debug("====quantity====" + quantity );
                                            var lineCnt = itemReceiptRecord.getLineCount({ sublistId: 'item' });
                                            for (var j = 0; j < lineCnt; j++) {
                                                var orderline = itemReceiptRecord.getSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'orderline',
                                                    line: j
                                                });
                                                if (orderline && orderline === lineId) {
                                                    // set received qty
                                                    if (quantity > 0) {
                                                        itemReceiptRecord.setSublistValue({
                                                            sublistId: 'item',
                                                            fieldId: 'quantity',
                                                            line: j,
                                                            value: quantity
                                                        });
                                                    } else {
                                                        itemReceiptRecord.setSublistValue({
                                                            sublistId: 'item',
                                                            fieldId: 'itemreceive',
                                                            line: j,
                                                            value: false
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                        // save the itemreceipt object
                                        var itemId = itemReceiptRecord.save({
                                            enableSourceing: true
                                        });

                                        log.debug("Item receipt is created for transfer order fulfillment with Item Id " + itemId);

                                    }
                                }
                            } catch (e) {
                                log.error({
                                    title: 'Error in processing transfer order fulfillment' + fulfillmentId,
                                    details: e,
                                });
                                var errorInfo = fulfillmentId + ',' + e.message + '\n';
                                errorList.push(errorInfo);
                            }
                        }
                        if (errorList.length !== 0) {
                            var fileLines = 'fulfillmentId,errorMessage\n';
                            fileLines = fileLines + errorList;

                            var date = new Date();
                            var errorFileName = date + '-ErrorTransferOrderFulfillmentReceipts.csv';
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

                        // Archive the file
                        connection.move({
                            from: '/' + fileName,
                            to: '/archive/' + fileName
                        })
                        log.debug('File moved!');
                    }
                }
            }
        } catch (e) {
            log.error({
                title: 'Error in creating transfer order fulfillment item receipt records',
                details: e,
            });
            throw error.create({
                name: "Error in creating transfer order fulfillment item receipt records",
                message: e
            });
        }
    }
    return {
        execute: execute
    };
});