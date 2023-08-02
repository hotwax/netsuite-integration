/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error'], function (search, record, error) {
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