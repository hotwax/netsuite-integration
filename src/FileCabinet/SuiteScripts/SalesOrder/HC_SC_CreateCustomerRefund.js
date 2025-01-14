/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp', 'N/file', 'N/runtime'], function (search, record, error, sftp, file, runtime) {
    function execute(context) {
      try {
          var usageThreshold = 500; // Set a threshold for remaining usage units
          var scriptObj = runtime.getCurrentScript();

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

          var list = connection.list({
              path: '/customer-refund/',
              sort: sftp.Sort.DATE
          });

          for (var i=0; i<list.length; i++) {
              if (scriptObj.getRemainingUsage() < usageThreshold) {
                log.debug('Scheduled script has exceeded the usage unit threshold.');
                return;
              }
              
              if (!list[i].directory) {
                  try {
                      var fileName = list[i].name;
      
                      // Download the file from the remote server
                      var downloadedFile = connection.download({
                          directory: '/customer-refund',
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
                              var refundAmount = orderDataList[dataIndex].refund_amount;
                              var shopifyPaymentMethodId = orderDataList[dataIndex].refund_payment_method;
                              var externalId = orderDataList[dataIndex].external_id;
                              var parentRefId = orderDataList[dataIndex].parent_ref_id;
                              
                              try {
                                if (refundAmount > 0 && orderId) {
                                    var depositInternalId = '';
                                    if (parentRefId) {
                                        var customerDepositSearch = search.create({
                                            type: search.Type.CUSTOMER_DEPOSIT,
                                            filters: [
                                                ['externalId', 'is', parentRefId]
                                            ],
                                            columns: ['internalid']
                                        })
                                        // Run the search
                                        var searchResults = customerDepositSearch.run().getRange({ start: 0, end: 1 });

                                        // If customer deposit found, retrieve its internal ID
                                        if (searchResults && searchResults.length > 0) {
                                            depositInternalId = searchResults[0].getValue({ name: 'internalid' });
                                        }
    
                                        log.debug("customer deposit id " + depositInternalId);
                                    } else {
                                        // Create search to find customer deposit associated with the sales order
                                        var customerDepositSearch = search.create({
                                            type: search.Type.CUSTOMER_DEPOSIT,
                                            filters: [
                                                ['createdfrom', 'is', orderId],
                                                'and',
                                                ['paymentmethod', 'is', shopifyPaymentMethodId]
                                            ],
                                            columns: [
                                                search.createColumn({
                                                    name: 'internalid',
                                                    sort: search.Sort.DESC
                                                })
                                            ]
                                        });
                                        // Run the search
                                        var searchResults = customerDepositSearch.run().getRange({ start: 0, end: 1 });

                                        // If customer deposit found, retrieve its internal ID
                                        if (searchResults && searchResults.length > 0) {
                                            depositInternalId = searchResults[0].getValue({ name: 'internalid' });
                                        }
                                     }
                                    
                                    if (depositInternalId) {
                                        var customerRefundRecord = record.transform({
                                            fromType: record.Type.CUSTOMER_DEPOSIT,
                                            fromId: depositInternalId,
                                            toType: record.Type.CUSTOMER_REFUND,
                                            isDynamic: false
                                        });
                                        
                                        customerRefundRecord.setValue({fieldId: 'paymentmethod', value: shopifyPaymentMethodId});
                                        customerRefundRecord.setSublistValue({
                                            sublistId: 'deposit',
                                            fieldId: 'amount',
                                            value: refundAmount,
                                            line: 0
                                        });
                                        if (externalId) {
                                            customerRefundRecord.setValue({fieldId: 'externalid', value: externalId});
                                        }
                                        
                                        var customerRefundId = customerRefundRecord.save();
                                        log.debug("customer refund is created with id " + customerRefundId);
                                    }                    
                                }
                              } catch (e) {
                                  log.error({
                                      title: 'Error in creating customer refund records for sales order ' + orderId,
                                      details: e,
                                  });
                                  var errorInfo = orderId + ',' + e.message + ',' + fileName + '\n';
                                  errorList.push(errorInfo);
                              }
                          }
                          if (errorList.length !== 0) {
                              var fileLines = 'orderId,errorMessage,fileName\n';
                              fileLines = fileLines + errorList;
                        
                              var date = new Date();
                              var errorFileName = date + '-ErrorCustomerRefund.csv';
                              var fileObj = file.create({
                                name: errorFileName,
                                fileType: file.Type.CSV,
                                contents: fileLines
                              });
          
                              connection.upload({
                                directory: '/customer-refund/error/',
                                file: fileObj
                              });
                          }
                          // Archive the file
                          connection.move({
                                from: '/customer-refund/' + fileName,
                                to: '/customer-refund/archive/' + fileName
                          })
                          log.debug('File moved!'); 
                      }
                  } catch (e) {
                      log.error({
                      title: 'Error in processing customer refund csv files',
                      details: e,
                      });
                  }
              }
          }         
        
      } catch (e) {
        log.error({
          title: 'Error in creating customer refund for sales orders',
          details: e,
        });
        throw error.create({
          name: "Error in creating customer refund for sales orders",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });