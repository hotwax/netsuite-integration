/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/search', 'N/record', 'N/error'], function (task, search, record, error) {
    function execute(context) {
      try {
        var date = new Date();
        var searchId = 'customsearch_hc_export_customer'; // Saved Search Id which will export customer records
      
        var savedSearch = search.load({ id: searchId });
    
        // Run the search
        var searchResult = savedSearch.run().getRange({ start: 0, end: 1 });
      
        // If the search returned no results, do not create the CSV file
        if (searchResult.length === 0) {
          log.debug('No results found. Skipping CSV file creation.');
          return;
        }

        var searchTask = task.create({
          taskType: task.TaskType.SEARCH
        });
  
        searchTask.savedSearchId = searchId;

        // Check Customer CSV Folder is created or not 
        var folderInternalId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Customer CSV']],
            columns: ['internalid']
          })
          .run()
          .getRange({ start: 0, end: 1 })
          .map(function (result) {
            return result.getValue('internalid');
        })[0];
      
        // Made Customer CSV folder in NetSuite File Cabinet
        if (folderInternalId == null) {
          var folder = record.create({ type: record.Type.FOLDER});
          folder.setValue({ fieldId: 'name',
                  value: 'Customer CSV' });
          var folderId = folder.save();
        }
  
        var fileName =  date + '-CustomerExport.csv';
        var path = 'Customer CSV/' + fileName;
        searchTask.filePath = path;
  
        var searchTaskId = searchTask.submit();
  
        var taskStatus = task.checkStatus(searchTaskId);

        log.debug("Search task is submitted ! " + taskStatus.status);
        log.debug("Customer CSV file Successfully Uploaded in NetSuite with file name ! " + fileName);
      } catch (e) {
        log.error({
          title: 'Error in generating customer csv files',
          details: e,
        });
        throw error.create({
          name:"Error in generating customer csv files",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });