/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp'], function (search, record, error, sftp) {
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

          sftpDirectory = sftpDirectory + 'salesorder';
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
              path: '/customerdeposit/'
          });

          for (var i=0; i<list.length; i++) {
              if (!list[i].directory) {
                  try {
                      var fileName = list[i].name;
      
                      // Download the file from the remote server
                      var downloadedFile = connection.download({
                          directory: '/customerdeposit',
                          filename: fileName
                      });
                      
                      if (downloadedFile.size > 0) {
                          log.debug("File downloaded successfully !" + fileName);
                          var contents = downloadedFile.getContents();
          
                          //Parse the JSON file
                          var orderDataList = JSON.parse(contents);
                          
                          for (var dataIndex = 0; dataIndex < orderDataList.length; dataIndex++) {
                              var orderId = orderDataList[dataIndex].order_id;
                              var totalAmount = orderDataList[dataIndex].total_amount;
                              var shopifyPaymentMethodId = orderDataList[dataIndex].payment_method;
                              
                              try {
                                if (totalAmount > 0 && orderId) {
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
                
                                    var customerDepositId = customerDeposit.save();
                                    log.debug("customer deposit is created with id " + customerDepositId);
                                }
                
                              } catch (e) {
                                  log.error({
                                      title: 'Error in creating customer deposit records for sales order ' + orderId,
                                      details: e,
                                  });
                              }
                          }
                          // Archive the file
                          connection.move({
                                from: '/customerdeposit/' + fileName,
                                to: '/customerdeposit/archive/' + fileName
                          })
                          log.debug('File moved!'); 
                      }
                  } catch (e) {
                      log.error({
                      title: 'Error in processing customer deposit csv files',
                      details: e,
                      });
                  }
              }
          }         
        
      } catch (e) {
        log.error({
          title: 'Error in creating customer deposit for sales orders',
          details: e,
        });
        throw error.create({
          name: "Error in creating customer deposit for sales orders",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });