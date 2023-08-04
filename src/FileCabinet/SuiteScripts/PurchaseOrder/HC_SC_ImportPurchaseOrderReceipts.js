/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
*/

define(['N/sftp', 'N/record', 'N/error'], function (sftp, record, error) {
    function execute(context) {
      try {
        // Establish a connection to a remote FTP server
        var hostKey = '';

        var connection = sftp.createConnection({
          username: '',
           keyId: '',
           url: '',
           port: 235,
           directory: '/home/{SFTP-USER}/{FOLDER}',
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
                }
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