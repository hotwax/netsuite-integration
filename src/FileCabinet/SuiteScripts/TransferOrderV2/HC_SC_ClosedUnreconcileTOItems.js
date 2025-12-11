/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp', 'N/file'], function (search, record, error, sftp, file) {
    function execute(context) {
      try {
        var searchId = 'customsearch_hc_closed_unreconcile_to'; 
      
        var savedSearch = search.load({ id: searchId });
    
        // Run the search
        var searchResult = savedSearch.run().getRange({ start: 0, end: 100 });
      
        // If the search returned no results, do not create the CSV file
        if (searchResult.length === 0) {
          log.debug('No results found. Skipping CSV file creation.');
          return;
        }
        var errorList = [];

        for (var index = 0; index < searchResult.length; index++) {
            var internalId = searchResult[index].getValue({
                name: 'internalId'
            });
            
            var lineId = searchResult[index].getValue({ name: 'transferorderitemline' });
             
            try {
                if (internalId) {
                    var transferOrderRecord = record.load({
                        type: record.Type.TRANSFER_ORDER,
                        id: internalId,
                        isDynamic: false
                    });
                     
                    // Close the item line
                    var lineCount = transferOrderRecord.getLineCount({ sublistId: 'item' });
                    for (var n = 0; n < lineCount; n++) {
                      var lineItemId = transferOrderRecord.getSublistValue({
                          sublistId: 'item',
                          fieldId: 'line',
                          line: n
                      });
                      if(lineItemId == lineId){
                        transferOrderRecord.setSublistValue({
                          sublistId: 'item',
                          fieldId: 'isclosed',
                          line: n,
                          value: true
                        });
                      }
                    }

                    var transferOrderId = transferOrderRecord.save();
                    log.debug("Transfer Order updated with id " + transferOrderId);
                }

            } catch (e) {
                log.error({
                    title: 'Error in closeing the transfer order line item ' + internalId,
                    details: e,
                });
                var errorInfo = internalId + ',' + e.message + '\n';
                errorList.push(errorInfo);
            }
        }
        if (errorList.length !== 0) {
          try {
            var fileLines = 'internalId,errorMessage\n';
            fileLines = fileLines + errorList;
      
            var date = new Date();
            var errorFileName = date + '-ErrorClosedTransferOrderItem.csv';
            var fileObj = file.create({
              name: errorFileName,
              fileType: file.Type.CSV,
              contents: fileLines
            });

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

            sftpDirectory = sftpDirectory + 'transferorderv2/export/receipt-reconciliation';
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

            connection.upload({
              directory: '/error/',
              file: fileObj
            });
          } catch (e) {
            log.error({
              title: 'Error in creating closed transfer orderitem csv file',
              details: e,
            });
          }
        }
        
      } catch (e) {
        log.error({
          title: 'Error in closing the transfer order items',
          details: e,
        });
        throw error.create({
          name: "Error in closing the transfer order items",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });