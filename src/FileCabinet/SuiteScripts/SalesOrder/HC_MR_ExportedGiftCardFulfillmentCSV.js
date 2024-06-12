/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {
        const getInputData = (inputContext) => {
            // Get sales order fulfillment search query
            var salesOrderFulfillmentSearch = search.load({ id: 'customsearch_hc_exp_giftcard_fulfillment' });
            return salesOrderFulfillmentSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var orderId = contextValues.values.formulatext;
            var giftCardNumber = contextValues.values.custcol_hc_giftcard_number;
            var shippedDate = contextValues.values.lastmodifieddate;
            var lineId = contextValues.values.line;

            var retailPrice = null;
            var orderline = null;
            var fulfillmentInternalId = contextValues.id;
            var shopifyCustomerNumber = null;
            var shopifyOrderNumber = null;
            
            if (fulfillmentInternalId) {
                
                var id = record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentInternalId,
                    values: {
                        custbody_hc_gc_fulfillment_exported: true
                    }
                });

                var itemFulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentInternalId,
                    isDynamic: false
                });

                // get line count from itemfulfillmet record object
                var fulfillmentLineCnt = itemFulfillmentRecord.getLineCount({sublistId: 'item'});
                for (var j = 0; j < fulfillmentLineCnt; j++) {
                    var fulfillmentLineId = itemFulfillmentRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: j
                    });
                    if (fulfillmentLineId === lineId) {
                        orderline = itemFulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: j
                        });
                    
                    }
                }

                if (orderId) {
                    var salesOrderRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: orderId,
                        isDynamic: false
                    });

                    shopifyOrderNumber = salesOrderRecord.getValue({fieldId: 'custbody_hc_shopify_order_id'});
                    var customerId = salesOrderRecord.getValue({fieldId: 'entity'});
                    if (customerId) {
                        var customerRecord = record.load({
                            type: record.Type.CUSTOMER,
                            id: customerId,
                            isDynamic: false
                        });
                        shopifyCustomerNumber = customerRecord.getValue({fieldId: 'custentity_hc_shop_cust_id'});
                    }

                    // Get line count
                    var lineCount = salesOrderRecord.getLineCount({
                        sublistId: 'item'
                    });
                    // Loop through each line item
                    for (var i = 0; i < lineCount; i++) {
                        // Get item ID
                        var itemLineId = salesOrderRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'line',
                            line: i
                        });
                        if (itemLineId === orderline) {
                            // Get item price
                            var itemPrice = salesOrderRecord.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'rate', // Adjust this fieldId based on your use case
                                line: i
                            });
                            retailPrice = itemPrice;
                        }
                    }
                }
            }

            var shipmentData = {
                'giftCardNumber': giftCardNumber,
                'shippedDate': shippedDate,
                'price' : retailPrice,
                'orderId': orderId,
                'shopifyOrderNumber': shopifyOrderNumber,
                'shopifyCustomerNumber': shopifyCustomerNumber
            };
            
            mapContext.write({
                key: contextValues.id + lineId,
                value: shipmentData
            });
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var shipmentId = reduceContext.key; 

            var content = contextValues.giftCardNumber + ','  + contextValues.shippedDate  + ',' + contextValues.price + ',' + contextValues.orderId + ',' + contextValues.shopifyOrderNumber + ',' + contextValues.shopifyCustomerNumber + '\n';
 
            reduceContext.write(shipmentId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'giftCardNumber,shippedDate,price,orderId,shopifyOrderNumber,shopifyCustomerNumber\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-GiftCardFulfillment.csv';
                    var fileObj = file.create({
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
                        name:"FILE_IS_TOO_BIG",
                        message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/giftcard-fulfillment/',
                        file: fileObj
                    });
                    log.debug("Sales Order Gift Card Fulfillment CSV File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading sales order gift card fulfillment csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading sales order gift card fulfillment csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });