/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/task', 'N/error'],
    (file, record, search, sftp, task, error) => {
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
            // Get store fulfilled transfer orders 
            var storeTOFulfillmentSearch = search.load({ id: 'customsearch_hc_exp_store_to_fulfill_v2' });
            return storeTOFulfillmentSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var fulfillmentInternalId = contextValues.values.internalid.value;
            var lineId = contextValues.values.line;

            var orderline = null;
            if (fulfillmentInternalId) {
                //Load item fulfillment object
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT, 
                    id: fulfillmentInternalId,
                    isDynamic: false
                });
                var lineCnt = fulfillmentRecord.getLineCount({sublistId: 'item'});
                for (var i = 0; i < lineCnt; i++) {
                    /* This is done to get the orderline which will serve as external ID for Shipment Item in OMS */
                    var fulfillmentLineId = fulfillmentRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: i
                    });
                    if (fulfillmentLineId === lineId) {
                        orderline = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: i
                        });
                    }
                }
                        
                var checkId  = checkInternalId(fulfillmentInternalId);
                if (checkId) {
                    var id = record.submitFields({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: fulfillmentInternalId,
                        values: {
                            custbody_hc_fulfillment_exported: true
                        }
                    });
                } 
            }
            if (orderline) {
                var transferFulfillmentData = {
                    'externalId': fulfillmentInternalId,
                    'shipmentId': contextValues.values.custbody_hc_shipment_id,
                    'lineId': orderline,
                    'shipmentItemSeqId': contextValues.values.custcol_hc_shipment_item_seq_id
                };
            }

            mapContext.write({
                key: fulfillmentInternalId,
                value: transferFulfillmentData
            });
        }
        
        const reduce = (reduceContext) => {
            let itemFulfillmentMap = {
                items: []
            };

            reduceContext.values.forEach((val) => {
                const item = JSON.parse(val);

                if (!itemFulfillmentMap.externalId) {
                    itemFulfillmentMap = {
                        externalId: item.externalId,
                        shipmentId: item.shipmentId,
                        items: []
                    };
                }

                itemFulfillmentMap.items.push({
                    externalId: item.lineId,
                    shipmentItemSeqId: item.shipmentItemSeqId
                });
            });

            reduceContext.write({
                key: reduceContext.key,
                value: JSON.stringify(itemFulfillmentMap)
            });
        }

        const summarize = (summaryContext) => {
            try {
                let result = [];
                
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    result.push(JSON.parse(value));
                    totalRecordsExported++;
                    return true;
                });


                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {
                    
                    var fileName = 'ExportStoreTOFulfillment-'  + summaryContext.dateCreated.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') + '.json';

                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.JSON,
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
                    
                    var sftpSecret = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_guid'
                    });

                    var sftpDirectory = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_default_file_dir'
                    });

                    sftpDirectory = sftpDirectory + 'transferorderv2';
                    sftpPort = parseInt(sftpPort);
        
                    var connection = sftp.createConnection({
                        username: sftpUserName,
                        secret: sftpSecret,
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
                        directory: '/import/fulfillment-store/',
                        file: fileObj
                    });
                    log.debug("Transfer Order Store Fulfillment jaon Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                //Generate error csv
                var errorFileLine = 'orderId,Recordtype\n';
                
                summaryContext.output.iterator().each(function (key, value) {
                    var internalId = key
                    var recordType = "ITEM_FULFILLMENT";

                    var valueContents = internalId + ',' + recordType + '\n';
                    errorFileLine += valueContents;

                    return true;
                });

                var fileName = summaryContext.dateCreated + '-FailedStoreTOFulfillmentExport.csv';
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
                    log.debug("Map/reduce task submitted!" + mapReduceTaskId);
                }

                log.error({
                title: 'Error in exporting and uploading transfer order store fulfillment json files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading transfer order store fulfillment json files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });