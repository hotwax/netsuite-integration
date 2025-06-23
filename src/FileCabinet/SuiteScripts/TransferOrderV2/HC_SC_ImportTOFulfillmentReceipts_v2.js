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
      
        var sftpSecret = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_guid'
        });

        var sftpDirectory = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_default_file_dir'
        });

        sftpDirectory = sftpDirectory + 'transferorderv2/export/';
        sftpPort = parseInt(sftpPort);

        var connection = sftp.createConnection({
            username: sftpUserName,
            secret: sftpSecret,
            url: sftpUrl,
            port: sftpPort,
            directory: sftpDirectory,
            hostKey: hostKey
        });
        log.debug("Connection established successfully with SFTP server!");

        var list = connection.list({
          path: '/receipt',
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
              directory: '/receipt',
              filename: fileName
            });
            if (downloadedFile.size > 0) {
              log.debug("File downloaded successfully !" + fileName);
              var contents = downloadedFile.getContents();
              
              //Parse the Transfer Order Shipment Receipt JSON file
              var transferOrderDataList = JSON.parse(contents);
              var errorList = [];              
              
              for (var dataIndex = 0; dataIndex < transferOrderDataList.length; dataIndex++) {
                var orderId = transferOrderDataList[dataIndex].orderId;
                var fulfillmentId = transferOrderDataList[dataIndex].fulfillmentId;
                var shipmentId = transferOrderDataList[dataIndex].shipmentId;
                var itemList = transferOrderDataList[dataIndex].items;

                try {
                  if (orderId) {
                    if (!fulfillmentId && shipmentId) {
                        // Search for the Item Fulfillment by Custom Field HC Shipment ID and get the fulfillment Id
                         var fulfillmentId = search.create({
                            type: search.Type.ITEM_FULFILLMENT,
                            filters: [['custbody_hc_shipment_id', 'is', shipmentId]],
                            columns: ['internalid']
                        })
                        .run()
                        .getRange({ start: 0, end: 1 })
                        .map(function (result) {
                            return result.getValue('internalid');
                        })[0];
                    }

                    // Initialize ItemReceipt Object from TransferOrder
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

                    for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                        /* Note:
                          1) OrderLine is key field to create ItemReceipt.
                          2) It field is used for transforms, because it implies a link between the previous transaction and the current one.
                          3) To add an item receipt from a transfer order, the transfer order lines would be "orderLines", because the receipt has not been saved.
                          4) We will add +2 increment for each transfer order line value while setting up it in ItemReceipt.
                           because Netsuite reserve +1 value of line value for ItemFulfillment record.
                           For Example: If transfer order contains 2 items, so order line values will be like
                           For first Item 1 for transfer order, 2 for ItemFulfillment, 3 for ItemReceipt
                           For second Item, 4 for transfer order, 5 for ItemFulfillment, 6 for ItemReceipt.
                        */
                        var lineId = Number(itemList[itemIndex].lineId) + 1;
                        lineId = lineId.toString();
  
                        var quantity = itemList[itemIndex].quantity;
                        var lineCnt = itemReceiptRecord.getLineCount({sublistId: 'item'});
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
                } catch(e) {
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
                    directory: '/receipt/error/',
                    file: fileObj
                  });
              }

              // Archive the file
              connection.move({
                from: '/receipt/' + fileName,
                to: '/receipt/archive/' + fileName
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