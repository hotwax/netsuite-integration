/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp', 'N/file', 'N/runtime'], function (search, record, error, sftp, file, runtime) {
    function execute(context) {
      try {
            var usageThreshold = 500; // Set a threshold for remaining usage units
            var scriptObj = runtime.getCurrentScript();

            var searchId = 'customsearch_hc_create_hotwax_fulfilled';
            var savedSearch = search.load({ id: searchId });
            var searchResults = savedSearch.run().getRange({ start: 0, end: 150 });

            if (!searchResults.length) {
                log.debug('No results found. Skipping Create Item Fulfillment');
                return;
            }
            var errorList = [];

            var itemFulfillmentMap = {};
            for (let i = 0; i < searchResults.length; i++) {
                var result = searchResults[i];

                var orderId = result.getValue({ name: 'internalid' }); 
                var locationInternalId = result.getValue({ name: 'location' });
                var itemLineId = result.getValue({ name: 'line' });
                var quantity = result.getValue({ name: 'quantity' });

                var groupKey = `${orderId}_${locationInternalId}`;

                if (!itemFulfillmentMap[groupKey]) {
                    itemFulfillmentMap[groupKey] = {
                        orderId: orderId,
                        locationId: locationInternalId,
                        items: []
                    };
                }

                itemFulfillmentMap[groupKey].items.push({
                    itemLineId: itemLineId,
                    locationInternalId: locationInternalId,
                    quantity: quantity
                });
            }
            // Convert map to array
            var itemFulfillmentList = Object.values(itemFulfillmentMap);
           
            for (let index = 0; index < itemFulfillmentList.length; index++) {
                try {
                    if (scriptObj.getRemainingUsage() < usageThreshold) {
                        log.debug('Scheduled script has exceeded the usage unit threshold.');
                        return;
                   }
                    var itemFulfillment = itemFulfillmentList[index];
                    var orderId = itemFulfillment.orderId;
                    var itemList = itemFulfillment.items;
                    var itemFulfillmentRecord = record.transform({
                        fromType: record.Type.SALES_ORDER,
                        fromId: orderId,
                        toType: record.Type.ITEM_FULFILLMENT,
                        isDynamic: false
                    });
                    itemFulfillmentRecord.setValue({
                        fieldId: 'shipstatus',
                        value: 'C'
                    });
                    
                    itemFulfillmentRecord.setValue({
                        fieldId: 'memo',
                        value: 'Item Fulfillment created by HotWax'
                    });

                    for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                        var lineId = itemList[itemIndex].itemLineId;
                        var locationId = itemList[itemIndex].locationInternalId;
                        var quantity = itemList[itemIndex].quantity;

                        // get line count from itemfulfillmet record object
                        var lineCnt = itemFulfillmentRecord.getLineCount({sublistId: 'item'});
                        for (var j = 0; j < lineCnt; j++) {
                            var orderline = itemFulfillmentRecord.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'orderline',
                                line: j
                            });
                            if (orderline === lineId) {
                                itemFulfillmentRecord.setSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'quantity',
                                    line: j,
                                    value: quantity
                                });

                                itemFulfillmentRecord.setSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'location',
                                    line: j,
                                    value: locationId
                                });

                                itemFulfillmentRecord.setSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'itemreceive',
                                    line: j,
                                    value: true
                                });
                            }
                        }
                    }
                    // save the itemfulfillment object
                    var itemFulfillmentId = itemFulfillmentRecord.save({
                        enableSourceing: true
                    });
                    log.debug("Item fulfillment is created with id " , itemFulfillmentId);
                } catch (e) {
                    log.error({
                        title: 'Error in Item fulfillment is created with id ' + orderId,
                        details: e,
                    });
                    var errorInfo = orderId + ',' + e.message + '\n';
                    errorList.push(errorInfo);
                }
            }
            if (errorList.length !== 0) {
                try {
                    var fileLines = 'orderId,errorMessage\n';
                    fileLines = fileLines + errorList;
                
                    var date = new Date();
                    var errorFileName = date + '-ErrorCreateSalesOrderItemFulfillment.csv';
                    var fileObj = file.create({
                        name: errorFileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

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

                    sftpDirectory = sftpDirectory + 'salesorder/update';
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

                    connection.upload({
                        directory: '/error/',
                        file: fileObj
                    });
                } catch (e) {
                    log.error({
                        title: 'Error in creating Create Sales Order Item Fulfillment csv file',
                        details: e,
                    });
                }
            }
        }
       catch (e) {
        log.error({
          title: 'Error in creating item fulfillment for sales orders',
          details: e,
        });
        throw error.create({
          name: "Error in creating item fulfillment for sales orders",
          message: e
        });
      }
    }
    
    return {
      execute: execute
    };
  });