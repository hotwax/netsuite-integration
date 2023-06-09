/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/sftp', 'N/task', 'N/error'], function (sftp, task, error) {
    function execute(context) {
      try {
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
          directory: '/home/{SFTP-USER}/{FOLDER}',
          hostKey: hostKey
        });

        log.debug("Connection established successfully with SFTP server!");

        var list = connection.list({
          path: '/csv/'
        });

        for (var i=0; i<list.length; i++) {
          if (!list[i].directory) {
          try {
            var fileName = list[i].name;

            // Download the file from the remote server
            var downloadedFile = connection.download({
              directory: '/csv',
              filename: fileName
            });
            log.debug("File downloaded successfully !"+fileName);

            // Create CSV import task
            var scriptTask = task.create({taskType: task.TaskType.CSV_IMPORT});
            scriptTask.mappingId = 'custimport_inventoryadjustment';
            scriptTask.importFile = downloadedFile;
            var csvImportTaskId = scriptTask.submit();
            
            var taskStatus = task.checkStatus(csvImportTaskId);
            if (taskStatus.status === 'FAILED') {
              log.debug("Inventory Adjustment CSV Import task has been failed");
            } else {
              connection.move({
                from: '/csv/'+fileName,
                to: '/archive/'+fileName
              })
              log.debug('File moved!');
            }
          } catch (e) {
              log.error({
                title: 'Error in processing inventory cycle count csv files',
                details: e,
              });
          }
          }
        }
      } catch (e) {
        log.error({
          title: 'Error in importing inventory cycle count csv files',
          details: e,
        });
        throw error.create({
          name:"Error in importing inventory cycle count csv files",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});