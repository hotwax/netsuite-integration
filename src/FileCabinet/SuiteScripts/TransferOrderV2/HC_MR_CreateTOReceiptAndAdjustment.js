/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp'],
  (file, record, search, sftp) => {
    // Global connection object
    let connection;

    const setupSftpConnection = () => {
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

      sftpDirectory = sftpDirectory + 'transferorderv2/export';
      sftpPort = parseInt(sftpPort);

      return sftp.createConnection({
        username: sftpUserName,
        secret: sftpKeyId,
        url: sftpUrl,
        port: sftpPort,
        directory: sftpDirectory,
        hostKey: hostKey
      });
    };

    const getInputData = (inputContext) => {
      // // Establish a connection to a remote FTP server
      connection = setupSftpConnection(); // Initialize connection globally
      log.debug("Connection established successfully with SFTP server!");

      var list = connection.list({
        path: '/receipt-reconciliation/',
        sort: sftp.Sort.DATE
      });

      for (var i = 0; i < list.length; i++) {
        if (!list[i].directory) {
          var fileName = list[i].name;

          // Download the file from the remote server
          var downloadedFile = connection.download({
            directory: '/receipt-reconciliation',
            filename: fileName
          });
          if (downloadedFile.size > 0) {
            log.debug("File downloaded successfully !" + fileName);
            var contents = downloadedFile.getContents();

            unreconciledTransferOrder = JSON.parse(contents);

            connection.move({
                from: '/receipt-reconciliation/' + fileName,
                to: '/receipt-reconciliation/archive/' + fileName
            })
            log.debug('File moved!');
            break;
          }
        }
      }
      return unreconciledTransferOrder;
    }

    const map = (mapContext) => {
      var contextValues = JSON.parse(mapContext.value);
      var transferOrderId = contextValues.transferOrderId;
      var hcOrderId = contextValues.hcOrderId;
      var orderName = contextValues.orderName;
      var receivedLocationId = contextValues.destinationFacilityId;
      var overReceivedItems = contextValues.overReceivedItems;
      var underReceivedShipments = contextValues.underReceivedShipments;

      try {
        // update Item Fulfillment record
        if (underReceivedShipments && underReceivedShipments.length > 0) {
          for (var i = 0; i < underReceivedShipments.length; i++) {
            var fulfillmentId = underReceivedShipments[i].fulfillmentId;
            var items = underReceivedShipments[i].items;

            var itemFulfillmentRecord = record.load({
              type: record.Type.ITEM_FULFILLMENT,
              id: fulfillmentId,
              isDynamic: false,
            });

            for (var j = 0; j < items.length; j++) {
              var lineId = items[j].lineId;
              var itemId = items[j].itemId;
              var underReceivedQty = items[j].underReceivedQty;

              var lineCount = itemFulfillmentRecord.getLineCount({
                sublistId: 'item',
              });

              for (var k = 0; k < lineCount; k++) {
                var currentOrderLineId = itemFulfillmentRecord.getSublistValue({
                  sublistId: 'item',
                  fieldId: 'orderline',
                  line: k,
                });
                var currentItemId = itemFulfillmentRecord.getSublistValue({
                  sublistId: 'item',
                  fieldId: 'item',
                  line: k,
                });

                if (currentOrderLineId == lineId && currentItemId == itemId) {
                  itemFulfillmentRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_hc_discrepancy_qty',
                    line: k,
                    value: underReceivedQty,
                  });
                  itemFulfillmentRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_hc_closed',
                    line: k,
                    value: true,
                  });

                  break;
                }
              }
            }

            var itemFulfillmentRecordId = itemFulfillmentRecord.save();
            log.debug('Item Fulfillment Record Updated', itemFulfillmentRecordId);
          }
        }

        // Create Item Receipt for under received fulfillments
        if (underReceivedShipments && underReceivedShipments.length > 0) {
          for (var i = 0; i < underReceivedShipments.length; i++) {
            var fulfillmentId = underReceivedShipments[i].fulfillmentId;
            var items = underReceivedShipments[i].items || []

            // Initialize Item Receipt from Transfer Order
            var itemReceiptRecord = record.transform({
              fromType: record.Type.TRANSFER_ORDER,
              fromId: transferOrderId,
              toType: record.Type.ITEM_RECEIPT,
              defaultValues: {
                itemfulfillment: fulfillmentId
              }
            });
            itemReceiptRecord.setValue({
              fieldId: 'memo',
              value: 'Item Receipt created by HotWax for under received items :- ' + orderName
            });

            for (var j = 0; j < items.length; j++) {
              var lineId = (Number(items[j].lineId) + 1).toString();
              var underReceivedQty = items[j].underReceivedQty;

              var lineCount = itemReceiptRecord.getLineCount({
                sublistId: 'item',
              });

              for (var k = 0; k < lineCount; k++) {
                var currentOrderLineId = itemReceiptRecord.getSublistValue({
                  sublistId: 'item',
                  fieldId: 'orderline',
                  line: k,
                });
                if (currentOrderLineId == lineId) {
                  log.debug('currentOrderLineId', currentOrderLineId);
                  log.debug('lineId', lineId);
                  log.debug('underReceivedQty', underReceivedQty);
                  itemReceiptRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: k,
                    value: Math.abs(underReceivedQty),
                  });
                  itemReceiptRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: k,
                    value: true
                  });

                  break;
                }
                itemReceiptRecord.setSublistValue({
                  sublistId: 'item',
                  fieldId: 'itemreceive',
                  line: k,
                  value: false
                });
              }
            }

            // Save the Item Receipt
            var itemReceiptId = itemReceiptRecord.save();
            log.debug('Item Receipt Created', itemReceiptId);
          }
        }

        // CREATE INVENTORY ADJUSTMENT FOR OVER + UNDER RECEIVED
        if ((overReceivedItems && overReceivedItems.length > 0) || (underReceivedShipments && underReceivedShipments.length > 0)) {

          var transferOrderAdjustmentRecord = record.create({
            type: record.Type.INVENTORY_ADJUSTMENT,
            isDynamic: true
          });

          transferOrderAdjustmentRecord.setValue({
            fieldId: 'memo',
            value: 'Adjustment created by HotWax for Transfer Order unreconciled items :- ' + orderName
          });

          transferOrderAdjustmentRecord.setValue({
            fieldId: 'account',
            value: 254   // Inventory Adjustment COGS account
          });

          transferOrderAdjustmentRecord.setValue({
            fieldId: 'adjlocation',
            value: receivedLocationId
          });

          transferOrderAdjustmentRecord.setValue({
            fieldId: 'custbody_hc_inventory_adj_number',
            value: hcOrderId
          });

          // 1) OVER RECEIVED = Increase Qty (Positive Adjustment)
          if (overReceivedItems && overReceivedItems.length > 0) {
            for (var i = 0; i < overReceivedItems.length; i++) {
              var itemId = overReceivedItems[i].itemId;
              var qty = overReceivedItems[i].overReceivedQty; // always positive

              transferOrderAdjustmentRecord.selectNewLine({ sublistId: 'inventory' });
              transferOrderAdjustmentRecord.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'item',
                value: itemId
              });
              transferOrderAdjustmentRecord.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'location',
                value: receivedLocationId
              });
              transferOrderAdjustmentRecord.setCurrentSublistValue({
                sublistId: 'inventory',
                fieldId: 'adjustqtyby',
                value: qty
              });

              transferOrderAdjustmentRecord.commitLine({ sublistId: 'inventory' });
            }
          }

          // 2) UNDER RECEIVED = Decrease Qty (Negative Adjustment)
          if (underReceivedShipments && underReceivedShipments.length > 0) {
            for (var j = 0; j < underReceivedShipments.length; j++) {
              var items = underReceivedShipments[j].items || [];

              for (var k = 0; k < items.length; k++) {
                var itemId = items[k].itemId;
                var qty = items[k].underReceivedQty;

                transferOrderAdjustmentRecord.selectNewLine({ sublistId: 'inventory' });
                transferOrderAdjustmentRecord.setCurrentSublistValue({
                  sublistId: 'inventory',
                  fieldId: 'item',
                  value: itemId
                });
                transferOrderAdjustmentRecord.setCurrentSublistValue({
                  sublistId: 'inventory',
                  fieldId: 'location',
                  value: receivedLocationId
                });
                transferOrderAdjustmentRecord.setCurrentSublistValue({
                  sublistId: 'inventory',
                  fieldId: 'adjustqtyby',
                  value: qty
                });

                transferOrderAdjustmentRecord.commitLine({ sublistId: 'inventory' });
              }
            }
          }
          // SAVE INVENTORY ADJUSTMENT
          var inventoryAdjId = transferOrderAdjustmentRecord.save();
          log.debug('Inventory Adjustment Created', inventoryAdjId);
        }

        // UPDATE TRANSFER ORDER
        if ((overReceivedItems && overReceivedItems.length > 0) || (underReceivedShipments && underReceivedShipments.length > 0)) {

          // Build discrepancy map from JSON
          // key = "orderLineId_itemId"
          var discrepancyMap = {};

          // Over received → positive qty
          if (overReceivedItems && overReceivedItems.length > 0) {
            for (var o = 0; o < overReceivedItems.length; o++) {
              var ovorderLineId = overReceivedItems[o].orderLineId; 
              var ovItemId = overReceivedItems[o].itemId;
              var ovQty = Number(overReceivedItems[o].overReceivedQty) || 0;

              var ovKey = ovorderLineId + '_' + ovItemId;
              discrepancyMap[ovKey] = (discrepancyMap[ovKey] || 0) + ovQty;
            }
          }

          // Under received → negative qty (underReceivedQty already negative)
          if (underReceivedShipments && underReceivedShipments.length > 0) {
            for (var u = 0; u < underReceivedShipments.length; u++) {
              var urItems = underReceivedShipments[u].items || [];

              for (var ui = 0; ui < urItems.length; ui++) {
                var urOrderLineId = urItems[ui].orderLineId;
                var urItemId = urItems[ui].itemId;
                var urQty = Number(urItems[ui].underReceivedQty) || 0;

                var urKey = urOrderLineId + '_' + urItemId;
                discrepancyMap[urKey] = (discrepancyMap[urKey] || 0) + urQty;
              }
            }
          }
          log.debug('Discrepancy Map Built', discrepancyMap);

          // 2) Load Transfer Order once
          var transferOrderRecord = record.load({
            type: record.Type.TRANSFER_ORDER,
            id: transferOrderId,
            isDynamic: false
          });

          var lineCountTO = transferOrderRecord.getLineCount({
            sublistId: 'item'
          });

          // 3) Loop through TO lines and apply discrepancy + close logic
          for (var n = 0; n < lineCountTO; n++) {

            var currentLineId = transferOrderRecord.getSublistValue({
              sublistId: 'item',
              fieldId: 'line',
              line: n
            });

            var currentItemIdTO = transferOrderRecord.getSublistValue({
              sublistId: 'item',
              fieldId: 'item',
              line: n
            });

            var key = currentLineId + '_' + currentItemIdTO;

            // Set discrepancy if present 
            if (discrepancyMap.hasOwnProperty(key)) {
              var netDiscQty = discrepancyMap[key];

              log.debug('Setting discrepancy on TO line', {
                line: currentLineId,
                item: currentItemIdTO,
                netDiscQty: netDiscQty
              });

              transferOrderRecord.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_hc_discrepancy_qty',
                line: n,
                value: netDiscQty
              });
            }


            // On Transfer Order, generally 'transferorderquantityshipped' shows fulfilled quantity
            var fulfilledQty = transferOrderRecord.getSublistValue({
              sublistId: 'item',
              fieldId: 'quantityfulfilled',
              line: n
            });

            // order line quantity
            var orderedQty = transferOrderRecord.getSublistValue({
              sublistId: 'item',
              fieldId: 'quantity',
              line: n
            });
            log.debug('Checking close condition on TO line', {
              line: currentLineId,
              item: currentItemIdTO,
              orderedQty: orderedQty,
              fulfilledQty: fulfilledQty
            });

            if (fulfilledQty < orderedQty && orderedQty > 0) {
              log.debug('Closing TO line', {
                line: currentLineId,
                item: currentItemIdTO,
                orderedQty: orderedQty,
                fulfilledQty: fulfilledQty
              });

              // System line close
              transferOrderRecord.setSublistValue({
                sublistId: 'item',
                fieldId: 'isclosed',
                line: n,
                value: true
              });
            }
          }

          var transferOrderRecordId = transferOrderRecord.save();
          log.debug('Transfer Order Record Updated (over + under + close logic)', transferOrderRecordId);
        }

      } catch (e) {
        log.error({
          title: 'Error in creating receipt and adjustment records for transfer order ' + transferOrderId,
          details: e,
        });

        var errorInfo = {
          orderId: transferOrderId,
          errorMessage: e.message || JSON.stringify(e)
        };

        mapContext.write({
          key: transferOrderId,
          value: JSON.stringify(errorInfo)
        });
      }

    }

    const reduce = (reduceContext) => {
      var key = reduceContext.key;

      reduceContext.values.forEach(function (val) {
        var contextValues = JSON.parse(val);
        var content = contextValues.orderId + ',' + contextValues.errorMessage + '\n';
        reduceContext.write(key, content);
      });
    }

    const summarize = (summaryContext) => {

      try {
        var fileLines = 'orderId,errorMessage\n';
        var totalErrorRecordsExported = 0;

        summaryContext.output.iterator().each(function (key, value) {
          fileLines += value;
          totalErrorRecordsExported = totalErrorRecordsExported + 1;
          return true;
        });

        log.debug("====totalErrorRecordsExported== " + totalErrorRecordsExported);

        if (totalErrorRecordsExported > 0) {
          connection = setupSftpConnection();
          log.debug("Connection established successfully with SFTP server!");

          var errorFileName = summaryContext.dateCreated + 'errorReceiptReconciliation.csv';
          var fileObj = file.create({
            name: errorFileName,
            fileType: file.Type.CSV,
            contents: fileLines
          });

          connection.upload({
            directory: '/receipt-reconciliation/error',
            file: fileObj
          });

          log.debug("Unreconciled Transfer Order CSV File Uploaded Successfully to SFTP server with file " + errorFileName);
        }
      } catch (e) {
        log.error({
          title: 'Error in exporting and uploading Unreconciled Transfer Order csv files',
          details: e,
        });
      }
    }
    return { getInputData, map, reduce, summarize }

  });