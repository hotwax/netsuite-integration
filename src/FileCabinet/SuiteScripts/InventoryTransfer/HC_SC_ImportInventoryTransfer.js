/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/sftp', 'N/task', 'N/error', 'N/search', 'N/file', 'N/runtime'], function (sftp, task, error, search, file, runtime) {
    function execute(context) {
      try {
        var usageThreshold = 500; // Set a threshold for remaining usage units
        var scriptObj = runtime.getCurrentScript();

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
  
        sftpDirectory = sftpDirectory + 'inventorytransfer';
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
          path: '/csv/',
          sort: sftp.Sort.DATE
        });

        for (var i=0; i<list.length; i++) {
          if (scriptObj.getRemainingUsage() < usageThreshold) {
            log.debug('Scheduled script has exceeded the usage unit threshold.');
            return;
          }
          
          if (!list[i].directory) {
          var fileName = null; 
          try {
            fileName = list[i].name;
            var errorList = [];

            // Download the file from the remote server
            var downloadedFile = connection.download({
              directory: '/csv',
              filename: fileName
            });
            log.debug("File downloaded successfully !"+fileName);

            if (downloadedFile && downloadedFile.size > 0) {
            // Create CSV import task
            var scriptTask = task.create({taskType: task.TaskType.CSV_IMPORT});
            scriptTask.mappingId = 'custimport_inventory_transfer_hc';
            scriptTask.importFile = downloadedFile;
            scriptTask.name = 'Add Inventory Transfer' + '-' + fileName;

            var csvImportTaskId = scriptTask.submit();
            
            var taskStatus = task.checkStatus(csvImportTaskId);
            if (taskStatus.status === 'FAILED') {
              log.debug("Inventory Transfer CSV Import task has been failed");
            } else {
              connection.move({
                from: '/csv/'+fileName,
                to: '/archive/'+fileName
              });
              log.debug('File moved!');
            }
            } else {
              connection.move({
                from: '/csv/'+fileName,
                to: '/archive/'+fileName
              });
              log.debug("File is empty, skipping task execution: " + fileName);
            }
          } catch (e) {
              log.error({
                title: 'Error in processing inventory transfer csv files',
                details: e,
              });
              var errMessage = e.message;
              errMessage = errMessage.replaceAll(',', '');
              errMessage = errMessage.replaceAll('\n', '\n,');
              var errorInfo = fileName + ',' + errMessage + '\n';
              errorList.push(errorInfo);
              if (errorList.length !== 0) {
                var fileLines = 'fileName,errorMessage\n';
                fileLines = fileLines + errorList;
          
                var date = new Date();
                var errorFileName = date + '-ErrorInventoryTransfer.csv';
                var fileObj = file.create({
                  name: errorFileName,
                  fileType: file.Type.CSV,
                  contents: fileLines
                });
      
                connection.upload({
                  directory: '/error/',
                  file: fileObj
                });
      
                // Move the file to failed dir
                connection.move({
                  from: '/csv/'+fileName,
                  to: '/failed/'+fileName
                });
              }
          }
          }
        }
      } catch (e) {
        log.error({
          title: 'Error in importing inventory transfer csv files',
          details: e,
        });
        throw error.create({
          name:"Error in importing inventory transfer csv files",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});