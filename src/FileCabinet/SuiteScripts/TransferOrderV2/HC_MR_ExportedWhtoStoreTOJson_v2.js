/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/error', 'N/file', 'N/task', 'N/record', 'N/search', 'N/sftp'],
 
    (error, file, task, record, search, sftp) => {
        const updateExportedLineFields = (transferOrderId, lineUpdates) => {
            log.audit({
                title: 'Updating exported TO state',
                details: {
                    transferOrderId: transferOrderId,
                    lineUpdates: lineUpdates
                }
            });

            var transferOrderRecord = record.load({
                type: record.Type.TRANSFER_ORDER,
                id: transferOrderId,
                isDynamic: false
            });

            var itemLineCount = transferOrderRecord.getLineCount({
                sublistId: 'item'
            });

            var availableLineIds = [];
            var sublistIndexByLineId = {};

            for (var lineIndex = 0; lineIndex < itemLineCount; lineIndex++) {
                var recordLineId = String(
                    transferOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: lineIndex
                    })
                );

                availableLineIds.push(recordLineId);
                sublistIndexByLineId[recordLineId] = lineIndex;
            }

            lineUpdates.forEach(function (lineUpdate) {
                var lineId = String(lineUpdate.lineId);
                var matchedLine = Object.prototype.hasOwnProperty.call(
                    sublistIndexByLineId,
                    lineId
                ) ? sublistIndexByLineId[lineId] : -1;

                if (matchedLine === -1) {
                    throw error.create({
                        name: 'HC_TO_LINE_NOT_FOUND',
                        message: 'Unable to find item line ' + lineId +
                            ' on Transfer Order ' + transferOrderId +
                            '. Available item line IDs: ' +
                            JSON.stringify(availableLineIds)
                    });
                }

                transferOrderRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_hc_exported_quantity',
                    line: matchedLine,
                    value: lineUpdate.quantity
                });

                transferOrderRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_hc_line_status',
                    line: matchedLine,
                    value: 'EXPORTED'
                });
            });

            transferOrderRecord.setValue({
                fieldId: 'custbody_hc_order_exported',
                value: true
            });

            var savedTransferOrderId = transferOrderRecord.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            log.audit({
                title: 'Exported TO state updated successfully',
                details: {
                    transferOrderId: savedTransferOrderId,
                    updatedLineCount: lineUpdates.length
                }
            });
        };

        const getInputData = (inputContext) => { 
            // Get StoreTransferOrder search query
            var WhToStoreTransferOrderSearch = search.load({ id: 'customsearch_hc_exp_wh_to_store_to_v2' });
            return WhToStoreTransferOrderSearch
        }

        const map = (mapContext) => {

            var contextValues = JSON.parse(mapContext.value);
            var internalid = contextValues.values.internalid.value;
            var whToStoreTransferOrderData = {
                'externalId': internalid,
                'productStoreId': 'STORE',
                'statusId': 'ORDER_CREATED',
                'originFacilityExternalId': contextValues.values.location.value,
                'destinationLocationId': contextValues.values.transferlocation.value,
                'orderTypeId':'TRANSFER_ORDER',
                'orderItemTypeId': 'PRODUCT_ORDER_ITEM',
                'itemStatusId': 'ITEM_CREATED',
                'orderDate': contextValues.values.formulatext,
                'productIdValue' : contextValues.values.item.value,
                'productIdType': 'NETSUITE_PRODUCT_ID',
                'lineId': contextValues.values.transferorderitemline,
                'quantity': contextValues.values.quantity,
                'unitListPrice': 0,
                'unitPrice': 0,
                'grandTotal': 0,
                'shipmentMethodTypeId': "STANDARD",
                'carrierPartyId': "_NA_",
                'orderName': contextValues.values.tranid,
                'statusFlowId': "TO_Receive_Only"
            };
            
            mapContext.write({
                key: internalid,
                value: whToStoreTransferOrderData
            });
            
        }

        const reduce = (reduceContext) => {

            let transferOrderMap = {
                shipGroups: []
            };
            let lineUpdates = [];

            reduceContext.values.forEach((val) => {
                const item = JSON.parse(val);
        
                if (!transferOrderMap.externalId) {
                    transferOrderMap = {
                        externalId: item.externalId,
                        orderName: item.orderName,
                        productStoreId: item.productStoreId,
                        statusId: item.statusId,
                        originFacilityExternalId: item.originFacilityExternalId,
                        orderTypeId: item.orderTypeId,
                        orderDate: item.orderDate,
                        statusFlowId: item.statusFlowId,
                        grandTotal: parseInt(item.grandTotal),
                        shipGroups: [
                            {
                                shipmentMethodTypeId: item.shipmentMethodTypeId,
                                carrierPartyId: item.carrierPartyId,
                                facilityId: item.originFacilityExternalId,
                                orderFacilityExternalId: item.destinationLocationId,
                                items: [] 
                            }
                        ],
                        identifications: [
                            {
                                orderIdentificationTypeId: 'NETSUITE_ORDER_ID',
                                idValue: item.externalId
                            },
                            {
                                orderIdentificationTypeId: 'NETSUITE_ORDER_NAME',
                                idValue: item.orderName
                            }   
                        ]
                    };
                }
        
                transferOrderMap.shipGroups[0].items.push({
                    externalId: item.lineId,
                    orderItemTypeId: item.orderItemTypeId,
                    productIdType: item.productIdType,
                    productIdValue: item.productIdValue,
                    quantity: parseInt(item.quantity),
                    statusId: item.itemStatusId,
                    unitListPrice: parseInt(item.unitListPrice),
                    unitPrice: parseInt(item.unitPrice),
                    attributes: [
                        {
                            attrName: 'NetsuiteItemLineId',
                            attrValue: item.lineId
                        }
                    ]
                });

                lineUpdates.push({
                    lineId: String(item.lineId),
                    quantity: Number(item.quantity)
                });
            });
        
            updateExportedLineFields(reduceContext.key, lineUpdates);

            reduceContext.write({
                key: reduceContext.key,
                value: JSON.stringify(transferOrderMap)
            });
        };
        
        const summarize = (summaryContext) => {

            try {
                let result = [];
                var totalRecordsExported = 0;


                if (summaryContext.inputSummary.error) {
                    log.error({
                        title: 'getInputData failed',
                        details: summaryContext.inputSummary.error
                    });
                }

                summaryContext.mapSummary.errors.iterator().each(function (key, value) {
                    log.error({
                        title: 'Map stage failed for result ' + key,
                        details: value
                    });
                    return true;
                });

                summaryContext.reduceSummary.errors.iterator().each(function (key, value) {
                    log.error({
                        title: 'Reduce stage failed for Transfer Order ' + key,
                        details: value
                    });
                    return true;
                });

                summaryContext.output.iterator().each(function(key, value) {
                    result.push(JSON.parse(value));
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                
                log.debug("====totalRecordsExported=="+ totalRecordsExported);
                
                if (totalRecordsExported > 0) {

                    fileName = 'ExportWhToStoreTransferOrder-' + summaryContext.dateCreated.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') + '.json';
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
                        directory: '/import/transfer-order',
                        file: fileObj
                    });
                    log.debug("Warehouse to Store Transfer Order JSON File Uploaded Successfully to SFTP server with file" , fileName);

                }
            } catch (e) {
                //Generate error csv
                var errorFileLine = 'orderId,Recordtype\n';
                
                summaryContext.output.iterator().each(function (key, value) {
                    var internalId = key;
                    var recordType = "TRANSFER_ORDER";
                    var valueContents = internalId + ',' + recordType + '\n';
                    errorFileLine += valueContents;

                    return true;
                });

                var fileName = summaryContext.dateCreated + '-FailedWhToStoreTransferOrderExport.csv';
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
                    log.debug("Map/reduce task submitted!", mapReduceTaskId);
                }

                log.error({
                title: 'Error in exporting and uploading warehouse to store transfer order json files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading warehouse to store transfer order json files",
                message: e
                });
            }   
        }
        return {getInputData, map, reduce, summarize}
});
