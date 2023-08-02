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
              var transferOrderDataList = JSON.parse(contents);
              
              for (var dataIndex = 0; dataIndex < transferOrderDataList.length; dataIndex++) {
                var orderId = transferOrderDataList[dataIndex].order_id;
                var itemList = transferOrderDataList[dataIndex].items;

                try {
                  if (orderId) {
                    // Initilize ItemReceipt Object from TransferOrder
                    var itemReceiptRecord = record.transform({
                      fromType: record.Type.TRANSFER_ORDER,
                      fromId: orderId,
                      toType: record.Type.ITEM_RECEIPT,
                      isDynamic: false
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
                      var lineId = Number(itemList[itemIndex].line_id) + 2;
                      lineId = lineId.toString();

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
                    log.debug("Item receipt is created for transfer order with Item Id " + itemId);
                  }
                } catch(e) {
                  log.error({
                    title: 'Error in processing transfer order' + orderId,
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
          title: 'Error in creating transfer order item receipt records',
          details: e,
        });
        throw error.create({
          name: "Error in creating transfer order item receipt records",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});