/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/error', 'N/task'],
    (file, record, search, sftp, error, task) => {
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
            var inventoryAdjustmentSearch = search.load({ id: 'customsearch_hc_exp_inventory_adjustment' });
            return inventoryAdjustmentSearch;
        }        

        const map = (mapContext) => {
            try {
                var contextValues = JSON.parse(mapContext.value);

                var internalid = contextValues.id;
                var itemId = contextValues.values.item.value;
                var productSku = contextValues.values.item.text;
                var lineId = contextValues.values.line;
                var quantity = contextValues.values.formulanumeric;
                var locationInternalId = contextValues.values.location.value;
                
                if (internalid) {
                    var checkId  = checkInternalId(internalid);
                    if (checkId) {
                        var id = record.submitFields({
                            type: record.Type.INVENTORY_ADJUSTMENT,
                            id: internalid,
                            values: {
                                custbody_hc_inven_adjustment_exported: true
                            }
                        });
                    } 
                } 

                var inventoryData = {
                    'Item': productSku,
                    'externalFacilityId': locationInternalId,
                    'idValue': itemId,
                    'availableQty': quantity,
                };
                
                mapContext.write({
                    key: contextValues.id + '-' + lineId,
                    value: inventoryData
                });
            } catch (e) {
                log.error({
                    title: 'Error in map function',
                    details: e
                });
            }
        }
        
        const reduce = (reduceContext) => {
            try {
                var contextValues = JSON.parse(reduceContext.values);
                var keyId = reduceContext.key; 

                var content = contextValues.Item + ',' + contextValues.externalFacilityId + ',' + contextValues.idValue + ',' + contextValues.availableQty + '\n';
                    reduceContext.write(keyId, content);
            } catch (e) {
                log.error({
                    title: 'Error in reduce function',
                    details: e
                });
            }
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'Item,externalFacilityId,idValue,availableQty\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-ExportInventoryAdjustment.csv';
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

                    sftpDirectory = sftpDirectory + 'inventoryitem';
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
                    log.debug("Inventory Adjustment File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                //Generate error csv
                var errorFileLine = 'orderId,Recordtype\n';
                
                summaryContext.output.iterator().each(function (key, value) {
                    var index = key.split('-')
                    var internalId = index[0]
                    var recordType = "INVENTORY_ADJUSTMENT"

                    var valueContents = internalId + ',' + recordType + '\n'
                    errorFileLine += valueContents;

                    return true;
                });

                var fileName = summaryContext.dateCreated + '-FailedInventoryTransferExport.csv';
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
                title: 'Error in exporting and uploading inventory adjustment csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading inventory adjustment csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });