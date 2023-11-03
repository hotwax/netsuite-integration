/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp', 'N/file'], function (search, record, error, sftp, file) {
    function execute(context) {
      try {  
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

          sftpDirectory = sftpDirectory + 'fulfilledsalesorder';
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
              path: '/export/'
          });

          for (var i=0; i<list.length; i++) {
              if (!list[i].directory) {
                  try {
                      var fileName = list[i].name;
      
                      // Download the file from the remote server
                      var downloadedFile = connection.download({
                          directory: '/export',
                          filename: fileName
                      });
                      
                      if (downloadedFile.size > 0) {
                          log.debug("File downloaded successfully !" + fileName);
                          var contents = downloadedFile.getContents();
          
                          //Parse the JSON file
                          var orderDataList = JSON.parse(contents);
                          var errorList = [];
                          
                          for (var dataIndex = 0; dataIndex < orderDataList.length; dataIndex++) {
                              var orderId = orderDataList[dataIndex].order_id;
                              log.debug("====order id==="+orderId);
                              var itemList = orderDataList[dataIndex].items;
                              var orderAttributes = orderDataList[dataIndex].orderAttributes;
                              var isHeaderLevelLocation = false;
                              
                              try {
                                if (orderId) {
                                    //Load sales order object
                                    var salesOrderRecord = record.load({
                                        type: record.Type.SALES_ORDER, 
                                        id: orderId,
                                        isDynamic: false
                                    });

                                    for (var attrIndex = 0; attrIndex < orderAttributes.length; attrIndex++) {
                                        var attrName = orderAttributes[attrIndex].attrName;
                                        var attrValue = orderAttributes[attrIndex].attrValue;
                                        if (attrName && attrName === 'ORDER_LEVEL_FULFILLMENT') {
                                            isHeaderLevelLocation = attrValue;  
                                        }
                                    }
                
                                    for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                                        var lineId = itemList[itemIndex].line_id;
                                        var locationId = itemList[itemIndex].location_id;
                                        var tags = itemList[itemIndex].tags; 
                                        if (isHeaderLevelLocation && isHeaderLevelLocation === 'true') {
                                            //add order location
                                            salesOrderRecord.setValue ({
                                                fieldId: 'location',
                                                value: locationId
                                            });
                                            // get line count from sales order object
                                            var salesOrderLineCnt = salesOrderRecord.getLineCount({sublistId: 'item'});
                                            for (var lineCountIndex = 0; lineCountIndex < salesOrderLineCnt; lineCountIndex++) {
                                                var salesOrderline = salesOrderRecord.getSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'line',
                                                    line: lineCountIndex
                                                });

                                                // update sales order record with tags
                                                if (salesOrderline === lineId) {    
                                                    if (tags) {
                                                        salesOrderRecord.setSublistValue({
                                                            sublistId: 'item',
                                                            fieldId: 'custcol_hc_item_tag',
                                                            line: lineCountIndex,
                                                            value: tags
                                                        });
                                                    }
                                                } 
                                            }
                                        } else { 
                                            // get line count from sales order object
                                            var salesOrderLineCnt = salesOrderRecord.getLineCount({sublistId: 'item'});
                                            for (var lineCountIndex = 0; lineCountIndex < salesOrderLineCnt; lineCountIndex++) {
                                                var salesOrderline = salesOrderRecord.getSublistValue({
                                                    sublistId: 'item',
                                                    fieldId: 'line',
                                                    line: lineCountIndex
                                                });

                                                // update sales order record with item level location
                                                if (salesOrderline === lineId) {    
                                                    salesOrderRecord.setSublistValue({
                                                        sublistId: 'item',
                                                        fieldId: 'location',
                                                        line: lineCountIndex,
                                                        value: locationId
                                                    });

                                                    if (tags) {
                                                        salesOrderRecord.setSublistValue({
                                                            sublistId: 'item',
                                                            fieldId: 'custcol_hc_item_tag',
                                                            line: lineCountIndex,
                                                            value: tags
                                                        });
                                                    }
                                                } 
                                            }
                                        }   
                                    }
                                    
                                    //save sales order record
                                    var salesOrderId = salesOrderRecord.save();

                                    if (salesOrderId) { 
                                        // Initilize ItemFulfillment Object from SalesOrder
                                        var itemFulfillmentRecord = record.transform({
                                            fromType: record.Type.SALES_ORDER,
                                            fromId: orderId,
                                            toType: record.Type.ITEM_FULFILLMENT,
                                            isDynamic: false
                                        });
                                        itemFulfillmentRecord.setValue({
                                            fieldId: 'shipstatus',
                                            value: 'C'//Shipped
                                        });
                                        
                                        // set memo
                                        itemFulfillmentRecord.setValue({
                                            fieldId: 'memo',
                                            value: 'Item Fulfillment is created by HotWax'
                                        });

                                        for (var itemIndex = 0; itemIndex < itemList.length; itemIndex++) {
                                            var lineId = itemList[itemIndex].line_id;
                                            var locationId = itemList[itemIndex].location_id;
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
                                        log.debug("Item fulfillment is created with id " + itemFulfillmentId);
                                    }
                                }
                
                              } catch (e) {
                                  log.error({
                                      title: 'Error in creating item fulfillment records for sales order ' + orderId,
                                      details: e,
                                  });
                                  var errorInfo = orderId + ',' + e.message + '\n';
                                  errorList.push(errorInfo);

                              }
                          }
                          if (errorList) {
                              var fileLines = 'orderId,errorMessage\n';
                              fileLines = fileLines + errorList;
                              
                              var date = new Date();
                              var errorFileName = date + '-ErrorFulfilledOrders.csv';
                              var fileObj = file.create({
                                  name: errorFileName,
                                  fileType: file.Type.CSV,
                                  contents: fileLines
                              });

                              connection.upload({
                                directory: '/export/error/',
                                file: fileObj
                              });
                          }
                          
                          // Archive the file
                          connection.move({
                                from: '/export/' + fileName,
                                to: '/export/archive/' + fileName
                          })
                          log.debug('File moved!'); 
                      }
                  } catch (e) {
                      log.error({
                      title: 'Error in processing item fulfillment csv files',
                      details: e,
                      });
                  }
              }
          }         
        
      } catch (e) {
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