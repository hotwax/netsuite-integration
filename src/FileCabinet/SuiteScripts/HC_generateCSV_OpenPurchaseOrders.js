/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/search', 'N/record'], function (task, search, record) {
    function execute(context) {
      var date = new Date();
      var searchId = 'customsearch_open_purchaserorder'; // Saved Search Id which will export open purchase order
  
      var searchTask = task.create({
        taskType: task.TaskType.SEARCH
      });
  
      searchTask.savedSearchId = searchId;

      // Check Open Purchase Order CSV Folder is created or not 
      var folderInternalId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Open Purchase Order CSV']],
            columns: ['internalid']
          })
          .run()
          .getRange({ start: 0, end: 1 })
          .map(function (result) {
            return result.getValue('internalid');
      })[0];
      
      // Made Open Purchase Order CSV folder in NetSuite File Cabinet
      if (folderInternalId == null) {
          var folder = record.create({ type: record.Type.FOLDER});
          folder.setValue({ fieldId: 'name',
                  value: 'Open Purchase Order CSV' });
          var folderId = folder.save();
      }
  
      var fileName =  date + '-OpenPurchaseExport.csv';
      var path = 'Open Purchase Order CSV/' + fileName;
      searchTask.filePath = path;
  
      var searchTaskId = searchTask.submit();
  
      var taskStatus = task.checkStatus(searchTaskId);

      log.debug("Search task is submitted ! " + taskStatus.status);
      log.debug("Open Purchase Order Fulfillment CSV file Successfully Uploaded in NetSuite with file name ! " + fileName);
    }
    return {
      execute: execute
    };
  });