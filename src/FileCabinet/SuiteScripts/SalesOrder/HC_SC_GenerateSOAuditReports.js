/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/search', 'N/record', 'N/error'], function (task, search, record, error) {
    function execute(context) {
      try {
        var date = new Date();
        var searchId = 'customsearch_hc_exp_so_audit'; // Saved Search Id which will export sales orders
  
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

        // Check Export Product CSV Folder is created or not 
        var folderInternalId = search
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
      
        // Made Export Product CSV folder in NetSuite File Cabinet
        if (folderInternalId == null) {
          var folder = record.create({ type: record.Type.FOLDER});
          folder.setValue({ fieldId: 'name',
                  value: 'Export SalesOrder Report CSV' });
          var folderId = folder.save();
        }
  
        var fileName =  date + '-HCExportSalesOrderReport.csv';
        var path = 'Export SalesOrder Report CSV/' + fileName;
        searchTask.filePath = path;
  
        var searchTaskId = searchTask.submit();
  
        var taskStatus = task.checkStatus(searchTaskId);

        log.debug("Search task is submitted ! " + taskStatus.status);
        log.debug("Export SalesOrder Report CSV file Successfully Uploaded in NetSuite with file name ! " + fileName);
      } catch (e) {
        log.error({
          title: 'Error in generating export salesorder report csv files',
          details: e,
        });
        throw error.create({
          name:"Error in generating export salesorder report csv files",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });