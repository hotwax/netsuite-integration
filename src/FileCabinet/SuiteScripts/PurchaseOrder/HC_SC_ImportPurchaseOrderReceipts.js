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

        sftpDirectory = sftpDirectory + 'purchaseorder/receipt';
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
            
              //Parse the PurchaseOrder ItemReceipt JSON file
              var poDataList = JSON.parse(contents);
              var errorList = [];
            
              for (var poDataIndex = 0; poDataIndex < poDataList.length; poDataIndex++) {
                var orderId = poDataList[poDataIndex].order_id;
                var itemList = poDataList[poDataIndex].items;
                
                try {
                  if (orderId) {
                    // Initilize ItemReceipt Object from PurchaseOrder
                    var itemReceiptRecord = record.transform({
                      fromType: record.Type.PURCHASE_ORDER,
                      fromId: orderId,
                      toType: record.Type.ITEM_RECEIPT,
                      isDynamic: false
                    });
                
                    // set memo
                    itemReceiptRecord.setValue({
                      fieldId: 'memo',
                      value: 'Item Receipt is created by HotWax'
                    });

                    for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                      var lineId = itemList[itemIndex].line_id;
                      var quantity = itemList[itemIndex].quantity;
                      var lineCnt = itemReceiptRecord.getLineCount({sublistId: 'item'});
                      var lineSeq = null;
                      for (var j = 0; j < lineCnt; j++) {
                        var orderline = itemReceiptRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: j
                        });
                        if (orderline === lineId) {
                            lineSeq = j;
                            break;
                        }
                      }
                      // set received qty
                      if (quantity > 0) {
                        itemReceiptRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            line: lineSeq,
                            value: quantity
                        });
                      } else {
                        itemReceiptRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'itemreceive',
                            line: lineSeq,
                            value: false
                        });
                      }
                    }
                    // save the itemreceipt object
                    var itemId = itemReceiptRecord.save({
                      enableSourceing: true
                    });
                    log.debug("Item receipt is created for purchase order with Item Id " + itemId);
                  }
                } catch(e) {
                    log.error({
                        title: 'Error in processing purchase order' + orderId,
                        details: e,
                    });
                    var errorInfo = orderId + ',' + e.message + '\n';
                    errorList.push(errorInfo);
                }
              }
              if (errorList.length !== 0) {
                  var fileLines = 'orderId,errorMessage\n';
                  fileLines = fileLines + errorList;
                
                  var date = new Date();
                  var errorFileName = date + '-ErrorPurchaseOrderReceipts.csv';
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
          title: 'Error in creating purchase order item receipt records',
          details: e,
        });
        throw error.create({
          name: "Error in creating purchase order item receipt records",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});