/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/file', 'N/sftp', 'N/search', 'N/error', 'N/record'], function(file, sftp, search, error, record) {
    function execute(context) {
      try {
        // Get the folder ID by name
        var folderId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Inventory Item CSV']],
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
          end: 1000, // Limit the number of files to retrieve at once
        });
  
        log.debug("===process number of CSV files==="+searchResult.length);
  
        if (searchResult.length > 0) {
            
            // Check Archive Inventory Item CSV Folder is created or not 
            var archiveFolderId = search
              .create({
                type: search.Type.FOLDER,
                filters: [['name', 'is', 'Archive Inventory Item CSV']],
                columns: ['internalid']
              })
              .run()
              .getRange({ start: 0, end: 1 })
              .map(function (result) {
                return result.getValue('internalid');
            })[0];

            // Made Archive Inventory Item CSV folder in NetSuite File Cabinet
            if (archiveFolderId == null) {
                var folder = record.create({ type: record.Type.FOLDER});
                folder.setValue({ fieldId: 'name',
                        value: 'Archive Inventory Item CSV' });
                        archiveFolderId = folder.save();
                log.debug("Made Archive Inventory Item CSV folder in NetSuite File Cabinet with Id ! " + archiveFolderId);
            }

            // Establish a connection to a remote FTP server
            /* The host key can be obtained using OpenSSH's ssh-keyscan tool:
               ssh-keyscan -t <hostKeyType> -p <port> <hostDomain>
               Example: ssh-keyscan -t ECDSA -p 235 hc-uat.hotwax.io 
            */
            var hostKey = '';
  
            var connection = sftp.createConnection({
                username: '',
                keyId: '',
                url: '',
                port: 235,
                directory: '/home/hc-uat-sftp/netsuite/inventoryitem',
                hostKey: hostKey
            });
            log.debug("Connection established successfully with SFTP server!");
  
            // Loop through the files and process them
            for (var i = 0; i < searchResult.length; i++) {
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
                log.debug("Inventory Item CSV File Uploaded Successfully to SFTP server with file Id " + fileObj.id);
                
                // Move the file to an archive folder
                fileObj.folder = archiveFolderId;
                fileObj.save();
            }
        }
      } catch (e) {
        log.error({
          title: 'Error processing in inventory item csv files',
          details: e,
        });
      }
    }
  
    return {
      execute: execute,
    };
  });