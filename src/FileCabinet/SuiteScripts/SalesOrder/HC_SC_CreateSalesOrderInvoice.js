/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error', 'N/sftp', 'N/file'], function (search, record, error, sftp, file) {
    function execute(context) {
      try {
        // Saved Search Id to fetch sales orders for auto billing
        var searchId = 'customsearch_export_so_for_invoice'; 
      
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
            var orderId = searchResult[index].getValue({
                name: 'internalId'
            });
            
            var date = searchResult[index].getValue({
                name: 'lastmodifieddate'
            });
             
            try {
                if (orderId) {
                    var invoiceRecord = record.transform({
                        fromType: record.Type.SALES_ORDER,
                        fromId: orderId,
                        toType: record.Type.INVOICE,
                        isDynamic: false
                    });
                     
                    invoiceRecord.setValue({fieldId: 'trandate', value: new Date(date)});

                    var invoiceId = invoiceRecord.save();
                    log.debug("Invoice is created with id " + invoiceId);
                }

            } catch (e) {
                log.error({
                    title: 'Error in creating invoice for sales order ' + orderId,
                    details: e,
                });
                var errorInfo = orderId + ',' + e.message + '\n';
                errorList.push(errorInfo);
            }
        }
        if (errorList.length !== 0) {
          try {
            var fileLines = 'orderId,errorMessage\n';
            fileLines = fileLines + errorList;
      
            var date = new Date();
            var errorFileName = date + '-ErrorSalesOrderInvoice.csv';
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

            sftpDirectory = sftpDirectory + 'salesorder/invoice';
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

            connection.upload({
              directory: '/error/',
              file: fileObj
            });
          } catch (e) {
            log.error({
              title: 'Error in creating erroneous invoice csv file',
              details: e,
            });
          }
        }
        
      } catch (e) {
        log.error({
          title: 'Error in creating invoice for sales orders',
          details: e,
        });
        throw error.create({
          name: "Error in creating invoice for sales orders",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });