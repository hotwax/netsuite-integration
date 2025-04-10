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
            var StoreTransferOrderSearch = search.load({ id: 'customsearch5735' });
            return StoreTransferOrderSearch
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            log.debug("====contextValues=="+ contextValues);

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
            let groupedOrder = {
                items: []
            };
        
            reduceContext.values.forEach((val) => {
                const item = JSON.parse(val);
        
                if (!groupedOrder.externalId) {
                    groupedOrder = {
                        externalId: item.externalId,
                        orderName: item.orderName,
                        productStoreId: item.productStoreId,
                        statusID: item.statusID,
                        sourceFacilityId: item.sourceFacilityId,
                        destinationFacilityId: item.destinationFacilityId,
                        orderTypeId: item.orderTypeId,
                        shipmethod: item.shipmethod,
                        shipcarrier: item.shipcarrier,
                        date: item.date,
                        statusFlowId: item.statusFlowId,
                        items: []
                    };
                }
        
                groupedOrder.items.push({
                    lineId: item.lineId,
                    productIdValue: item.productIdValue,
                    quantity: item.quantity,
                    itemStatusId: item.itemStatusId
                });
            });
        
            reduceContext.write({
                key: reduceContext.key,
                value: JSON.stringify(groupedOrder)
            });
        };
        
        const summarize = (summaryContext) => {

            try {
        
                let result = [];
                var totalRecordsExported = 0;


                summaryContext.output.iterator().each(function(key, value) {
                    result.push(JSON.parse(value));
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });

                
                log.debug("====totalRecordsExported=="+ totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileObj = file.create({
                        name: summaryContext.dateCreated + '-ExportStoreTransferOrder.json',
                        fileType: file.Type.PLAINTEXT,
                        contents: JSON.stringify(result, null, 2),
                        encoding: file.Encoding.UTF_8
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