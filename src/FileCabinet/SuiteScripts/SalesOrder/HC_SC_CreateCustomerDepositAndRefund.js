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
              path: '/CD-CR/',
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
                          directory: '/CD-CR',
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
                              var totalAmount = orderDataList[dataIndex].total_amount;
                              var externalId = orderDataList[dataIndex].external_id;
                              var statusId = orderDataList[dataIndex].status_id;
                              var parentRefId = orderDataList[dataIndex].parent_ref_id;
                              var shopifyPaymentMethodId = orderDataList[dataIndex].payment_method;
                              
                              try {
                                // Create a customer deposit
                                if (totalAmount > 0 && orderId && statusId === 'PAYMENT_SETTLED') {
                                    var fieldLookUp = search.lookupFields({
                                      type: search.Type.SALES_ORDER,
                                      id: orderId,
                                      columns: ['lastmodifieddate']
                                    });
                                    var date = fieldLookUp.lastmodifieddate;
                                        
                                    var customerDeposit = record.create({
                                        type: record.Type.CUSTOMER_DEPOSIT, 
                                        isDynamic: false,
                                        defaultValues: {
                                            salesorder: orderId 
                                        }
                                     });
                
                                    customerDeposit.setValue({fieldId: 'payment', value: totalAmount});
                                    customerDeposit.setValue({fieldId: 'trandate', value: new Date(date)});
                                    customerDeposit.setValue({fieldId: 'paymentmethod', value: shopifyPaymentMethodId});
                                    if (externalId) {
                                        customerDeposit.setValue({fieldId: 'externalid', value: externalId});
                                    }
                
                                    var customerDepositId = customerDeposit.save();
                                    log.debug("customer deposit is created with id " + customerDepositId);
                                }
                                // Create a customer refund
                                if (totalAmount > 0 && orderId && statusId === 'PAYMENT_REFUNDED') {
                                    var depositInternalId = '';
                                    // Create search to find customer deposit associated with Parent Ref Id of customer Refund
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
                                    // If customer deposit found, retrieve its internal ID
                                    if (depositInternalId) {
                                        var customerRefundRecord = record.transform({
                                            fromType: record.Type.CUSTOMER_DEPOSIT,
                                            fromId: depositInternalId,
                                            toType: record.Type.CUSTOMER_REFUND,
                                            isDynamic: false
                                        });
                                        
                                        customerRefundRecord.setValue({fieldId: 'paymentmethod', value: shopifyPaymentMethodId});
                                        if (externalId) {
                                            customerRefundRecord.setValue({fieldId: 'externalid', value: externalId});
                                        }
                                        customerRefundRecord.setSublistValue({
                                            sublistId: 'deposit',
                                            fieldId: 'amount',
                                            value: totalAmount,
                                            line: 0
                                        });
                                        
                                        var customerRefundId = customerRefundRecord.save();
                                        log.debug("customer refund is created with id " + customerRefundId);
                                    } else {
                                        log.debug("Customer Deposit Not Found Unable to process a customer refund because the Parent Reference Number provided is invalid or missing " , orderId);
                                        var errorInfo = orderId + ',' + "Customer Deposit Not Found Unable to process a customer refund because the Parent Reference Number provided is invalid or missing" + ',' + fileName + '\n';
                                        errorList.push(errorInfo);
                                    }                  
                                }
                
                              } catch (e) {
                                  log.error({
                                      title: 'Error in creating customer deposit and customer refund records for sales order ' + orderId,
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
                              var errorFileName = date + '-ErrorCustomerDepositAndRefund.csv';
                              var fileObj = file.create({
                                name: errorFileName,
                                fileType: file.Type.CSV,
                                contents: fileLines
                              });
          
                              connection.upload({
                                directory: '/CD-CR/error/',
                                file: fileObj
                              });
                          }
                          // Archive the file
                          connection.move({
                                from: '/CD-CR/' + fileName,
                                to: '/CD-CR/archive/' + fileName
                          })
                          log.debug('File moved!'); 
                      }
                  } catch (e) {
                      log.error({
                      title: 'Error in creating customer deposit and customer refund records for sales order',
                      details: e,
                      });
                  }
              }
          }         
        
      } catch (e) {
        log.error({
          title: 'Error in creating customer deposit and customer refund records for sales order',
          details: e,
        });
        throw error.create({
          name: "Error in creating customer deposit and customer refund records for sales order ",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });