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

        const getSearchValue = (value) => {
            if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
                return value.value;
            }
            return value;
        };

        const updateExportedLineFields = (transferOrderId, lineUpdates) => {
            var transferOrderRecord = record.load({
                type: record.Type.TRANSFER_ORDER,
                id: transferOrderId,
                isDynamic: false
            });

            var itemLineCount = transferOrderRecord.getLineCount({ sublistId: 'item' });
            var availableLineIds = [];
            var sublistIndexByLineId = {};

            for (var line = 0; line < itemLineCount; line++) {
                var recordLineId = String(
                    transferOrderRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: line
                    })
                );

                availableLineIds.push(recordLineId);
                sublistIndexByLineId[recordLineId] = line;
            }

            lineUpdates.forEach((lineUpdate) => {
                var lineId = String(lineUpdate.lineId);
                var matchedLine = Object.prototype.hasOwnProperty.call(
                    sublistIndexByLineId,
                    lineId
                ) ? sublistIndexByLineId[lineId] : -1;

                if (matchedLine === -1) {
                    throw error.create({ name: 'HC_TO_LINE_NOT_FOUND', message: 'Unable to find item line ' + lineId + ' on Transfer Order ' + transferOrderId + '. Available item line IDs: ' + JSON.stringify(availableLineIds) });
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

            log.audit({ title: 'Exported TO state updated successfully', details: {
                    transferOrderId: savedTransferOrderId,
                    updatedLineCount: lineUpdates.length
                }
            });
        };

        const getInputData = (inputContext) => { 
            // Get StoreTransferOrder search query
            var StoreTransferOrderSearch = search.load({ id: 'customsearch_hc_exp_store_to_store_to_v2' });
            return StoreTransferOrderSearch
        }

        const map = (mapContext) => {

            var contextValues = JSON.parse(mapContext.value);
            var internalid = contextValues.values.internalid.value;

            var storetransferorderdata = {
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
                'lineUniqueKey': getSearchValue(contextValues.values.lineuniquekey),
                'quantity': contextValues.values.quantity,
                'unitListPrice': 0,
                'unitPrice': 0,
                'itemTotalDiscount': 0,
                'grandTotal': 0,
                'shipmentMethodTypeId': "SECOND_DAY",  // When TO origin facility is store, shipment method is always SECOND_DAY
                'carrierPartyId': "_NA_",
                'orderName': contextValues.values.tranid,
                'statusFlowId': "TO_Fulfill_And_Receive"
            };
            
            mapContext.write({
                key: internalid,
                value: storetransferorderdata
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
                    quantity: parseInt(item.quantity)
                });
            });
        
            reduceContext.write({
                key: reduceContext.key,
                value: JSON.stringify({
                    payload: transferOrderMap,
                    lineUpdates: lineUpdates
                })
            });
        };
        
        const summarize = (summaryContext) => {

            try {
                let result = [];
                let exportedStateUpdates = [];
                var totalRecordsExported = 0;


                summaryContext.output.iterator().each(function(key, value) {
                    var reduceOutput = JSON.parse(value);
                    result.push(reduceOutput.payload);
                    exportedStateUpdates.push({
                        transferOrderId: key,
                        lineUpdates: reduceOutput.lineUpdates
                    });
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                
                log.debug("====totalRecordsExported=="+ totalRecordsExported);
                
                if (totalRecordsExported > 0) {

                    fileName = 'ExportStoretoStoreTransferOrder-' + summaryContext.dateCreated.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') + '.json';
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
                    log.debug("Store to Store Transfer Order JSON File Uploaded Successfully to SFTP server with file" , fileName);

                    exportedStateUpdates.forEach(function (stateUpdate) {
                        updateExportedLineFields(
                            stateUpdate.transferOrderId,
                            stateUpdate.lineUpdates
                        );
                    });
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
                    log.debug("Map/reduce task submitted!", mapReduceTaskId);
                }

                log.error({
                title: 'Error in exporting and uploading store transfer order json files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading store transfer order json files",
                message: e
                });
            }   
        }
        return {getInputData, map, reduce, summarize}
});