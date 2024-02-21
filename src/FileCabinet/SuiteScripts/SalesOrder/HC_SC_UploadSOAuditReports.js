/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/file', 'N/sftp', 'N/search', 'N/error', 'N/record', 'N/search'], function(file, sftp, search, error, record, search) {
    function execute(context) {
      try {
        // Get the folder ID by name
        var folderId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Export SalesOrder Report CSV']],
            columns: ['internalid']
          })
          .run()
          .getRange({ start: 0, end: 1 })
          .map(function (result) {
            return result.getValue('internalid');
        })[0];

        if (!folderId) {
          throw new Error('Folder not found.');
        }

        
        // Retrieve the CSV files from the File Cabinet
        var fileSearch = search.create({
          type: 'file',
          filters: [
            ['filetype', 'is', 'CSV'],
            'AND',
            ['folder', 'is', folderId],
          ],
        });
        var searchResult = fileSearch.run().getRange({
          start: 0,
          end: 20, // Limit the number of files to retrieve at once
        });
  
        log.debug("===process number of CSV files==="+searchResult.length);
  
        if (searchResult.length > 0) {
            
            // Check Archive Export SalesOrder Report CSV Folder is created or not 
            var archiveFolderId = search
              .create({
                type: search.Type.FOLDER,
                filters: [['name', 'is', 'Archive Export SalesOrder Report CSV']],
                columns: ['internalid']
              })
              .run()
              .getRange({ start: 0, end: 1 })
              .map(function (result) {
                return result.getValue('internalid');
            })[0];

            // Made Archive Export SalesOrder Report CSV folder in NetSuite File Cabinet
            if (archiveFolderId == null) {
                var folder = record.create({ type: record.Type.FOLDER});
                folder.setValue({ fieldId: 'name',
                        value: 'Archive Export SalesOrder Report CSV' });
                        archiveFolderId = folder.save();
                log.debug("Made Archive Export SalesOrder Report CSV folder in NetSuite File Cabinet with Id ! " + archiveFolderId);
            }

            // Establish a connection to a remote FTP server
            /* The host key can be obtained using OpenSSH's ssh-keyscan tool:
               ssh-keyscan -t <hostKeyType> -p <port> <hostDomain>
               Example: ssh-keyscan -t ECDSA -p 235 hc-uat.hotwax.io 
            */
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
      
            sftpDirectory = sftpDirectory + 'salesorder_audit_report';
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
  
            // Loop through the files and process them
            for (var i = 0; i < searchResult.length; i++) {
              try {
                var fileObj = file.load({
                    id: searchResult[i].id,
                });
                // Process the CSV file
                if (fileObj.size > connection.MAX_FILE_SIZE) {
                    throw error.create({
                    name:"FILE_IS_TOO_BIG",
                    message:"The file you are trying to upload is too big"
                    });
                }
  
                connection.upload({
                    directory: '/csv/',
                    file: fileObj
                });
                log.debug("Export sales order report CSV File Uploaded Successfully to SFTP server with file Id " + fileObj.id);
                
                // Move the file to an archive folder
                fileObj.folder = archiveFolderId;
                fileObj.save();
              } catch (e) {
                log.error({
                  title: 'Error in uploading export sales order report csv files',
                  details: e,
                });
              }
            }
        }
      } catch (e) {
        log.error({
          title: 'Error in processing export sales order report csv files',
          details: e,
        });
        throw error.create({
          name:"Error in processing export sales order report csv files",
          message: e
        });
      }
    }
  
    return {
      execute: execute,
    };
  });