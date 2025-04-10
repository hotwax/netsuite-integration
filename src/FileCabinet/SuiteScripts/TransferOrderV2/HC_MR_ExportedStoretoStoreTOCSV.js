/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/error', 'N/file', 'N/task', 'N/record', 'N/search', 'N/sftp'],
 
    (error, file, task, record, search, sftp) => {
        const internalIdList = new Set([]);
        
        const checkInternalId = (internalid) => {
            if (internalIdList.has(internalid)) {
                return false;
            } else {
                internalIdList.add(internalid);
                return true;
            }
        }

        const getInputData = (inputContext) => { 
            // Get StoreTransferOrder search query
            var StoreTransferOrderSearch = search.load({ id: 'customsearch5734' });
            return StoreTransferOrderSearch
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            log.debug("====contextValues=="+ contextValues.values);

            var internalid = contextValues.values.internalid.value;
            var productSku = contextValues.values.item.value;
            var lineId = contextValues.values.transferorderitemline;
            var quantity = contextValues.values.quantity;
            var locationInternalId = contextValues.values.location.value;
            var destinationLocationId = contextValues.values.transferlocation.value;
            var date = contextValues.values.formulatext;     
            var transferOrderNumber = contextValues.values.tranid;
           
            if (internalid) {
                var checkId  = checkInternalId(internalid);
                if (checkId) {
                    var id = record.submitFields({
                        type: record.Type.TRANSFER_ORDER,
                        id: internalid,
                        values: {
                            custbody_hc_order_exported: true
                        }
                    });
                } 
            } 

            var storetransferorderdata = {
                'externalId': internalid,
                'productStoreId': 'STORE',
                'statusID': 'ORDER_CREATED',
                'sourceFacilityId': locationInternalId,
                'destinationFacilityId': destinationLocationId,
                'orderTypeId':'TRANSFER_ORDER',
                'orderItemTypeId': 'PRODUCT_ORDER_ITEM',
                'itemStatusId': 'ITEM_CREATED',
                'date':date,
                'productIdValue' : productSku,
                'productIdType': 'NETSUITE_PRODUCT_ID',
                'lineId': lineId,
                'quantity': quantity,
                'unitListPrice': 0,
                'unitPrice': 0,
                'itemTotalDiscount': 0,
                'grandTotal': 0,
                'shipmethod': "STANDARD",
                'shipcarrier': "_NA_",
                'orderName': transferOrderNumber,
                'statusFlowId': "TO_Fulfill_Only"
            };
            
            mapContext.write({
                key: contextValues.values.tranid,
                value: storetransferorderdata
            });
        }


      const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var storetransferOrderId = reduceContext.key; 

            var content = contextValues.externalId + ',' + contextValues.productStoreId + ',' + contextValues.statusID + ',' + contextValues.sourceFacilityId + ',' + contextValues.destinationFacilityId + ',' + contextValues.orderTypeId + ',' + contextValues.orderItemTypeId + ',' + contextValues.itemStatusId + ',' + contextValues.date + ',' + contextValues.productIdValue + ',' + contextValues.productIdType + ',' + contextValues.lineId + ',' + contextValues.quantity + ',' + contextValues.unitListPrice + ',' + contextValues.unitPrice + ',' + contextValues.itemTotalDiscount + ',' + contextValues.grandTotal + ',' + contextValues.shipmethod + ',' + contextValues.shipcarrier + ',' + contextValues.orderName + ',' + contextValues.statusFlowId + '\n';
            reduceContext.write(storetransferOrderId, content);
        }
      
        const summarize = (summaryContext) => {

            try {

                var fileLines = 'external-id,product-store-id,status-id,external-facility-id,external-placing-facility-id,order-type-id,order-item-type-id,item-status-id,entry-date,product-id-value,product-id-type,item-external-id,quantity,unit-list-price,unit-price,item-total-discount,grand-total,shipment-method-type-id,carrier-party-id,order-name,status-flow-id\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+ totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-ExportStoreTransferOrder.csv';
                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

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

                    sftpDirectory = sftpDirectory + 'transferorderv2';
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
                    log.debug("Store Transfer Order CSV File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                //Generate error csv

                log.debug("Exceptions: " , e);              
                var errorFileLine = 'orderId,Recordtype\n';
                
                summaryContext.output.iterator().each(function (key, value) {
                    var index = key.split('-')
                    var internalId = index[0];
                    var recordType = "TRANSFER_ORDER";

                    var valueContents = internalId + ',' + recordType + '\n';
                    errorFileLine += valueContents;

                    return true;
                });

                var fileName = summaryContext.dateCreated + '-FailedStoreTransferOrderExport.csv';
                var failExportCSV = file.create({
                    name: fileName,
                    fileType: file.Type.CSV,
                    contents: errorFileLine
                });

                // Check HotWax Export Fail Record CSV is created or not
                var folderInternalId = search
                    .create({
                        type: search.Type.FOLDER,
                        filters: [['name', 'is', 'HotWax Export Fail Record CSV']],
                        columns: ['internalid']
                    })
                    .run()
                    .getRange({ start: 0, end: 1 })
                    .map(function (result) {
                        return result.getValue('internalid');
                    })[0];

                // Made Export Fail Sales Order CSV folder in NetSuite File Cabinet
                if (folderInternalId == null) {
                    var folder = record.create({ type: record.Type.FOLDER });
                    folder.setValue({
                        fieldId: 'name',
                        value: 'HotWax Export Fail Record CSV'
                    });

                    var folderInternalId = folder.save();
                }    
                    
                failExportCSV.folder = folderInternalId;
                failExportCSV.save();

                if (folderInternalId) {
                    var scriptTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                    });

                    scriptTask.scriptId = 'customscript_hc_mr_mark_false',
                    scriptTask.deploymentId = 'customdeploy_hc_mr_mark_false'
                    scriptTask.params = { "custscript_hc_mr_mark_false": folderInternalId }

                    var mapReduceTaskId = scriptTask.submit();
                    log.debug("Map/reduce task submitted!");
                }

                log.error({
                title: 'Error in exporting and uploading store transfer order csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading store transfer order csv files",
                message: e
                });
            }   
        }
        return {getInputData, map, reduce, summarize}
});