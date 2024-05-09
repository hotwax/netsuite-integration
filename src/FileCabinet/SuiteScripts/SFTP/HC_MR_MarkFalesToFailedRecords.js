/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/error', 'N/file', 'N/record', 'N/search', 'N/runtime'],

  (error, file, record, search, runtime) => {
    const getInputData = (inputContext) => {
      var completionScriptParameterName = 'custscript_hc_mr_mark_false';
      var folderId = runtime.getCurrentScript().getParameter({
        name: completionScriptParameterName
      });

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
        end: 1, // Limit the number of files to retrieve at once
      });
    
      log.debug("===process number of CSV files===" + searchResult.length);

      for (var i = 0; i < searchResult.length; i++) {
        var fileObj = file.load({
          id: searchResult[i].id,
        });
      }
      return fileObj
    }

    const map = (mapContext) => {
      var contextValues = mapContext.value
      var Values = contextValues.split(',')
      var internalid = Values[0]
      var RecordType = Values[1]

      try {
        if (internalid !== "orderId") {
          if (RecordType == "SALES_ORDER") {
            record.submitFields({
              type: record.Type.SALES_ORDER,
              id: internalid,
              values: {
                custbody_hc_order_exported: false
              }
            }); 
          } else if (RecordType == "TRANSFER_ORDER") {
            record.submitFields({
              type: record.Type.TRANSFER_ORDER,
              id: internalid,
              values: {
                custbody_hc_order_exported: false
              }
            }); 
          } else if (RecordType == "ITEM_FULFILLMENT") {
            record.submitFields({
              type: record.Type.ITEM_FULFILLMENT,
              id: internalid,
              values: {
                custbody_hc_fulfillment_exported: false
              }
            }); 
          } else if (RecordType == "CUSTOMER") {
            record.submitFields({
              type: record.Type.CUSTOMER,
              id: internalid,
              values: {
                custentity_hc_cust_exported: false
              }
            }); 
          }
        } 
      } catch (e) {
        log.error({
          title: 'Error in mark export true sales orders ' + internalid,
          details: e,
        });   
      }
    }

    const reduce = (reduceContext) => {

    }
       
    const summarize = (summaryContext) => {
      try {
        var completionScriptParameterName = 'custscript_hc_mr_mark_false';
        var folderId = runtime.getCurrentScript().getParameter({
          name: completionScriptParameterName
        });
        
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
          end: 1, // Limit the number of files to retrieve at once
        });

        for (var i = 0; i < searchResult.length; i++) {
          var fileObj = file.load({
            id: searchResult[i].id,
          });
        }

        var archiveFolderId = search
          .create({
            type: search.Type.FOLDER,
            filters: [['name', 'is', 'Archive HotWax Export Fail Record CSV']],
            columns: ['internalid']
          })
          .run()
          .getRange({ start: 0, end: 1 })
          .map(function (result) {
            return result.getValue('internalid');
          })[0];

        // Made Archive Export Fail Sales Order CSV folder in NetSuite File Cabinet
        if (archiveFolderId == null) {
          var folder = record.create({ type: record.Type.FOLDER });
          folder.setValue({
            fieldId: 'name',
            value: 'Archive HotWax Export Fail Record CSV'
          });
          archiveFolderId = folder.save();
          log.debug("Made Archive Export Fail Sales Order CSV folder in NetSuite File Cabinet with Id ! " + archiveFolderId);
        }

        fileObj.folder = archiveFolderId;
        fileObj.save();

        log.debug("The file has been successfully moved to the Archive Export Fail Sales Order CSV folder");
     
      } catch (e) {
        log.debug({
          title: "Error in move file in the archive",
          details: e
        })

        throw error.create({
          name: "Error in move file in the archive",
          message: e
        });
      }
    }

    return { getInputData, map, reduce, summarize }

  });
