/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */

define(['N/sftp', 'N/record', 'N/error', 'N/search', 'N/file', 'N/format'], function (sftp, record, error, search, file, format) {

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

            sftpDirectory = sftpDirectory + 'pos-return';
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
                        var returnAuthorizationDataList = JSON.parse(contents);
                        var errorList = [];

                        for (var dataIndex = 0; dataIndex < returnAuthorizationDataList.length; dataIndex++) {
                            var orderId = returnAuthorizationDataList[dataIndex].order_id;
                            var itemList = returnAuthorizationDataList[dataIndex].items;
                            var paymentlist = returnAuthorizationDataList[dataIndex].payment_list;
                            var exchangeCredit = returnAuthorizationDataList[dataIndex].exchange_credit;
                            var itemDiscount = returnAuthorizationDataList[dataIndex].item_discount;
                            try {
                                if (orderId) {
                                    // Initialize Return Authorization from Sales Order
                                    var returnAuthorizationRecord = record.transform({
                                        fromType: record.Type.SALES_ORDER,
                                        fromId: orderId,
                                        toType: record.Type.RETURN_AUTHORIZATION,
                                        isDynamic: true
                                    });

                                    // get customer ID
                                    var customerID =  returnAuthorizationRecord.getValue({
                                        fieldId: 'entity', 
                                    });

                                    // Set order status
                                    returnAuthorizationRecord.setValue({
                                        fieldId: 'orderstatus',
                                        value: "B"
                                    });                        
                                    
                                    var lineCount = returnAuthorizationRecord.getLineCount({
                                        sublistId: 'item'   
                                    });

                                    var removeListline = [];
                                    for (var j = 0; j < lineCount; j++) {
                                        var matchFound = false;
                                        var itemid = returnAuthorizationRecord.getSublistValue({
                                            sublistId: 'item',
                                            fieldId: 'item',
                                            line: j
                                        });

                                        var externallineid = returnAuthorizationRecord.getSublistValue({
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
                                            var returnReason = itemList[itemIndex].return_reason;

                                            // If return item match with sales order item
                                            if (productId === itemid && returnlineid === externallineid) {
                                                matchFound = true;
                                                returnAuthorizationRecord.selectLine({
                                                    sublistId: 'item',
                                                    line: j
                                                });

                                                returnAuthorizationRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'quantity',
                                                    value: returnquantity
                                                });

                                                // Custom price level
                                                returnAuthorizationRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'price',
                                                    value: "-1"
                                                });

                                                returnAuthorizationRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'amount',
                                                    value: returnamount
                                                });

                                                // Set return reason memo
                                                if (returnReason !== null) {
                                                    returnAuthorizationRecord.setCurrentSublistValue({
                                                        sublistId: 'item',
                                                        fieldId: 'custcol_hc_retrun_reason',
                                                        value: returnReason
                                                    });
                                                }

                                                if (locationid !== "") {
                                                    returnAuthorizationRecord.setCurrentSublistValue({
                                                        sublistId: 'item',
                                                        fieldId: 'location',
                                                        value: locationid
                                                    });
                                                }

                                                returnAuthorizationRecord.commitLine({
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
                                            returnAuthorizationRecord.removeLine({
                                                sublistId: 'item',
                                                line: removeitem
                                            });
                                        }
                                    }

                                    if (exchangeCredit) {
                                        for (var creditIndex = 0; creditIndex < exchangeCredit.length; creditIndex++) {
                                            var creditProductId = exchangeCredit[creditIndex].product_id
                                            var creditAmount = exchangeCredit[creditIndex].amount
                                            
                                            returnAuthorizationRecord.selectNewLine({
                                                sublistId: 'item',
                                            });
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'item',
                                                value: creditProductId
                                            });
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'price',
                                                    value: "-1"
                                            });
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'amount',
                                                value: creditAmount
                                            });
                                            returnAuthorizationRecord.commitLine({
                                                sublistId: 'item'
                                            });
                                        }
                                    }

                                    if (itemDiscount) {
                                        for (var itemDiscountIndex = 0; itemDiscountIndex < itemDiscount.length; itemDiscountIndex++) {
                                            var itemDiscountProductId = itemDiscount[itemDiscountIndex].product_id
                                            var itemDiscountAmount = itemDiscount[itemDiscountIndex].amount
                                            var itemDiscountLineID = itemDiscount[itemDiscountIndex].external_order_line_id
                                            var itemDiscountLocationId = itemDiscount[itemDiscountIndex].location_id
                                           
                                            returnAuthorizationRecord.selectNewLine({
                                                sublistId: 'item',
                                            })
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'item',
                                                value: itemDiscountProductId
                                            })
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'price',
                                                value: "-1"
                                            })
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'amount',
                                                value: itemDiscountAmount
                                            })
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'custcol_hc_orderline_type_id',
                                                value: itemDiscountLineID
                                            })
                                            returnAuthorizationRecord.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'location',
                                                value: itemDiscountLocationId
                                            })
                                            returnAuthorizationRecord.commitLine({
                                                sublistId: 'item'
                                            })
                                        }
                                    }
                                    // Save the Return Authorization
                                    var returnAuthorizationId = returnAuthorizationRecord.save();

                                    log.debug("Return Authorization created for POS order with ID: " + orderId + ", RMA ID: " + returnAuthorizationId);

                                    // Create item receipt
                                    if (returnAuthorizationId) {
                                        var itemReceipt = record.transform({
                                            fromType: record.Type.RETURN_AUTHORIZATION,
                                            fromId: returnAuthorizationId,
                                            toType: record.Type.ITEM_RECEIPT,
                                            isDynamic: true
                                        });
                                        var itemReceiptlineCount = itemReceipt.getLineCount({
                                            sublistId: 'item'
                                        });

                                        for (var itemlineid = 0; itemlineid < itemReceiptlineCount; itemlineid++) {
                                            itemReceipt.selectLine({
                                                sublistId: 'item',
                                                line: itemlineid
                                            })

                                            itemReceipt.setCurrentSublistValue({
                                                sublistId: 'item',
                                                fieldId: 'itemreceive',
                                                value: true
                                            })
                                        }

                                        var itemReceiptId = itemReceipt.save();

                                        log.debug("Item Receipt created for return authorization with ID: " + returnAuthorizationId + ", Item Receipt ID: " + itemReceiptId);
                                    }

                                    // Create Credit Memo
                                    if (itemReceiptId) {
                                        var creditMemo = record.transform({
                                            fromType: record.Type.RETURN_AUTHORIZATION,
                                            fromId: returnAuthorizationId,
                                            toType: record.Type.CREDIT_MEMO,
                                            isDynamic: true
                                        })

                                        var creditMemoId = creditMemo.save();

                                        log.debug("Credit Memo created for return authorization with ID: " + returnAuthorizationId + ", Credit Memo ID: " + creditMemoId);
                                    }

                                    if (creditMemoId) {
                                        for (let list = 0; list < paymentlist.length; list++) {
                                            var paymentID = paymentlist[list].payment_method_id
                                            var refundAmount = paymentlist[list].amount
                                            
                                            var customerRefund = record.create({
                                                type: record.Type.CUSTOMER_REFUND,
                                                isDynamic: true,
                                                defaultValues: {
                                                entity: customerID,
                                                }
                                            })
                                    
                                            customerRefund.setValue({
                                                fieldId: 'customer', 
                                                value: customerID 
                                            })
                                            log.debug({
                                                title: "customerID",
                                                details: customerID
                                            })

                                            // Set Payment Method
                                            customerRefund.setValue({
                                                fieldId: 'paymentmethod', 
                                                value: paymentID 
                                            })

                                            var lineCountMemo = customerRefund.getLineCount({
                                                sublistId: 'apply'
                                            });

                                            for (var countMemo = 0; countMemo < lineCountMemo; countMemo++){
                                                customerRefund.selectLine({
                                                    sublistId: 'apply',
                                                    line: countMemo
                                                });

                                                var creditid = customerRefund.getCurrentSublistValue({
                                                    sublistId: 'apply',
                                                    fieldId: 'internalid',
                                                });

                                                if (creditMemoId == creditid) {
                                                    customerRefund.setCurrentSublistValue({
                                                        sublistId: 'apply',
                                                        fieldId: 'apply',
                                                        value: true
                                                    });
                                                    
                                                    customerRefund.setCurrentSublistValue({
                                                        sublistId: 'apply',
                                                        fieldId: 'amount',
                                                        value: refundAmount
                                                    });

                                                }
                                            }

                                            var customerRefundId = customerRefund.save();

                                            log.debug("Customer Refund created for credit memo with ID: " + creditMemoId + ", Customer Refund ID: " + customerRefundId);
                                        }
                                    }
                                }
                            } catch (e) {
                                log.error({
                                    title: 'Error in processing POS order ' + orderId,
                                    details: e
                                });
                                var errorInfo = orderId + ',' + e.message + '\n';
                                errorList.push(errorInfo);
                            }
                        }
                        
                        if (errorList.length !== 0) {
                            var fileLines = 'orderId,errorMessage\n';
                            fileLines = fileLines + errorList;

                            var date = new Date();
                            var errorFileName = date + '-ErrorPOSReturnAuthorizations.csv';
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
                        });
                        log.debug('File moved!' + fileName);
                    }
                }
            }
        } catch (e) {
            log.error({
                title: 'Error in creating POS Return Authorizations',
                details: e
            });
            throw error.create({
                name: "Error in creating POS Return Authorizations",
                message: e
            });
        }
    }
    return {
        execute: execute
    };
});