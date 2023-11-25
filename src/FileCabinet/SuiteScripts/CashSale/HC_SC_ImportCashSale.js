/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/sftp', 'N/task', 'N/error', 'N/search', 'N/file'], function (sftp, task, error, search, file) {
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

        sftpDirectory = sftpDirectory + 'cashsale';
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
          var fileName = null;
          
          try {
            fileName = list[i].name;
            var errorList = [];

            // Download the file from the remote server
            var downloadedFile = connection.download({
              directory: '/export',
              filename: fileName
            });
            log.debug("File downloaded successfully !"+fileName);

            // Create CSV import task
            var scriptTask = task.create({taskType: task.TaskType.CSV_IMPORT});
            scriptTask.mappingId = 'custimport_add_cashsale_hc';
            scriptTask.importFile = downloadedFile;
            scriptTask.name = 'Add Cash Sale' + '-' + fileName;
            var csvImportTaskId = scriptTask.submit();
            
            var taskStatus = task.checkStatus(csvImportTaskId);
            if (taskStatus.status === 'FAILED') {
              log.debug("Import Cash Sale CSV task has been failed");
            } else {
              // Archive the file
              connection.move({
                from: '/export/'+fileName,
                to: '/export/archive/'+fileName
              });
              log.debug('File moved!');
            }
          } catch (e) {
              log.error({
                title: 'Error in processing cash sale csv files',
                details: e,
              });
              var errorInfo = fileName + ',' + e.message + '\n';
              errorList.push(errorInfo);
              if (errorList.length !== 0) {
                var fileLines = 'fileName,errorMessage\n';
                fileLines = fileLines + errorList;
          
                var date = new Date();
                var errorFileName = date + '-ErrorCashSale.csv';
                var fileObj = file.create({
                  name: errorFileName,
                  fileType: file.Type.CSV,
                  contents: fileLines
                });
      
                connection.upload({
                  directory: '/export/error/',
                  file: fileObj
                });
      
                // Move the file to failed dir
                connection.move({
                  from: '/export/'+fileName,
                  to: '/export/failed/'+fileName
                });
              }
            }
          }
        }
      } catch (e) {
        log.error({
          title: 'Error in importing cash sale csv files',
          details: e,
        });
        throw error.create({
          name:"Error in importing cash sale csv files",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});