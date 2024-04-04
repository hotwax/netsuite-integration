/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/sftp', 'N/file'],  

( record, search, sftp, file) => {
     
 const afterSubmit = (context) => {
                
     log.debug("User event Script start" )
     
     try {
         if (context.type === context.UserEventType.CREATE) {
         
                    var errorList = [];
                    
                    var newRecord = context.newRecord;

                    var createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
                    
                    var returnFieldid = search.lookupFields({
                        type: search.Type.RETURN_AUTHORIZATION,
                        id: createdFrom,
                        columns: ["custbody_hc_payment_method"]
                    })

                    var paymentMethodId = returnFieldid.custbody_hc_payment_method

                    if (paymentMethodId) {
                     
                                var creditMemo = record.transform({
                                    fromType: record.Type.RETURN_AUTHORIZATION,
                                    fromId: createdFrom,
                                    toType: record.Type.CREDIT_MEMO,
                                    isDynamic: true
                                });

                                // get customer ID from Credit meme
                                var customerID =  creditMemo.getValue({
                                    fieldId: 'entity', 
                                   });

                                var creditMemoId = creditMemo.save();

                                log.debug("Credit Memo created for return authorization with ID: " + createdFrom + ", Credit Memo ID: " + creditMemoId);
                          
                                   if(creditMemoId) {
                                    var customerRefund = record.create({
                                        type: record.Type.CUSTOMER_REFUND,
                                        isDynamic: true,
                                        defaultValues: {
                                            entity: customerID,
                                        }
                                    });

                                    customerRefund.setValue({
                                        fieldId: 'customer', 
                                        value: customerID 
                                    });

                                     // Set Payment Method
                                    customerRefund.setValue({
                                        fieldId: 'paymentmethod', 
                                        value: paymentMethodId 
                                       });

                                     var lineCountMemo = customerRefund.getLineCount({
                                        sublistId: 'apply'
                                       });

                                       for (var countMemo = 0; countMemo < lineCountMemo; countMemo++){
                                        
                                        customerRefund.selectLine({
                                            sublistId: 'apply',
                                            line: countMemo
                                           });
                                        
                                           var creditid = customerRefund.getCurrentSublistValue({
                                            sublistId: 'apply',
                                            fieldId: 'internalid',
                                          });

                                        if(creditMemoId == creditid) {
                                            customerRefund.setCurrentSublistValue({
                                                sublistId: 'apply',
                                                fieldId: 'apply',
                                                value: true
                                              });
                                        } else {
                                            customerRefund.setCurrentSublistValue({
                                                sublistId: 'apply',
                                                fieldId: 'apply',
                                                value: false
                                              });
                                        }

                                       }

                                     var customerRefundId = customerRefund.save();
     
                                     log.debug("Customer Refund created for credit memo with ID: " + creditMemoId + ", Customer Refund ID: " + customerRefundId);
                               
                                }

                    } else {
                        
                        log.debug("Payment Method is not Found for return authorization ID: " + createdFrom );

                    }

            }
            
         } catch (e) {
            log.error({
                title: 'Error in creating credit memo and customer refund return authorization ID:' + createdFrom ,
                details: e
            });  

            var errorInfo = createdFrom + ',' + e.message + '\n';
            errorList.push(errorInfo);

            if (errorList.length !== 0) {

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
  
              sftpDirectory = sftpDirectory + 'salesorder/return';
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
  
  
              var fileLines = 'ReturnID,errorMessage\n';
              fileLines = fileLines + errorList;
  
              var date = new Date();
              var errorFileName = date + '-ErrorReturnRefund.csv';
              var fileObj = file.create({
                  name: errorFileName,
                  fileType: file.Type.CSV,
                  contents: fileLines
              });
  
              connection.upload({
                  directory: '/error/',
                  file: fileObj
              });
              log.debug('Error File moved!  ' + errorFileName);

          }
            
        }
            log.debug("User Event Script End")

     }

        return {afterSubmit}

 });
