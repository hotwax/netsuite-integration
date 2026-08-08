/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/error', 'N/file', 'N/record', 'N/search', 'N/sftp', 'N/runtime'],
    (error, file, record, search, sftp, runtime) => {
        const FLOW_CONFIG = {
            WH_TO_STORE: {
                originFacilityFromSearch: false,
                originFacilityExternalId: '_NA_',
                shipmentMethodTypeId: 'STANDARD',
                statusFlowId: 'TO_Receive_Only',
                defaultFilePrefix: 'UpdateWhToStoreTransferOrder-'
            },
            STORE_TO_WH: {
                originFacilityFromSearch: true,
                shipmentMethodTypeId: 'SECOND_DAY',
                statusFlowId: 'TO_Fulfill_Only',
                defaultFilePrefix: 'UpdateStoretoWhTransferOrder-'
            },
            STORE_TO_STORE: {
                originFacilityFromSearch: true,
                shipmentMethodTypeId: 'SECOND_DAY',
                statusFlowId: 'TO_Fulfill_And_Receive',
                defaultFilePrefix: 'UpdateStoretoStoreTransferOrder-'
            }
        };

        const getSearchValue = (value) => {
            if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
                return value.value;
            }
            return value;
        };

        const hasValue = (value) => {
            return value !== null && value !== undefined && value !== '';
        };

        const getFlowConfig = () => {
            var flowType = runtime.getCurrentScript().getParameter({
                name: 'custscript_hc_delta_flow_type'
            });

            var flowConfig = FLOW_CONFIG[flowType];

            if (!flowConfig) {
                throw error.create({
                    name: 'INVALID_FLOW_TYPE',
                    message: 'Unsupported flow type: ' + flowType
                });
            }

            return flowConfig;
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
                    throw error.create({
                        name: 'HC_TO_LINE_NOT_FOUND',
                        message: 'Unable to find item line ' + lineId +
                            ' on Transfer Order ' + transferOrderId +
                            '. Available item line IDs: ' + JSON.stringify(availableLineIds)
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

            var savedTransferOrderId = transferOrderRecord.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            log.audit({
                title: 'Exported TO line state updated successfully',
                details: {
                    transferOrderId: savedTransferOrderId,
                    updatedLineCount: lineUpdates.length
                }
            });
        };

        const getInputData = () => {
            var savedSearchId = runtime.getCurrentScript().getParameter({
                name: 'custscript_hc_delta_search_id'
            });

            if (!savedSearchId) {
                throw error.create({
                    name: 'MISSING_SAVED_SEARCH',
                    message: 'The custscript_hc_delta_search_id parameter is required.'
                });
            }

            return search.load({ id: savedSearchId });
        };

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);
            var values = contextValues.values;
            var flowConfig = getFlowConfig();

            var internalId = getSearchValue(values.internalid);
            var lineUniqueKey = getSearchValue(values.lineuniquekey);
            var hcOrderLineId = getSearchValue(values.custcol_hc_order_line_id);
            var lineStatus = getSearchValue(values.custcol_hc_line_status);
            var exportedQuantityValue = getSearchValue(values.custcol_hc_exported_quantity);
            var currentQuantity = parseInt(getSearchValue(values.quantity));
            var hasExportedQuantity = hasValue(exportedQuantityValue);
            var exportedQuantity = hasExportedQuantity ? parseInt(exportedQuantityValue) : null;

            var isNewLine = !hasValue(hcOrderLineId) && lineStatus !== 'EXPORTED';
            var isQuantityUpdated = hasExportedQuantity && currentQuantity !== exportedQuantity;

            if (!isNewLine && !isQuantityUpdated) {
                return;
            }

            var originFacilityExternalId = flowConfig.originFacilityFromSearch
                ? getSearchValue(values.location)
                : flowConfig.originFacilityExternalId;

            var transferOrderLineData = {
                'externalId': internalId,
                'productStoreId': 'STORE',
                'statusId': 'ORDER_CREATED',
                'originFacilityExternalId': originFacilityExternalId,
                'destinationLocationId': getSearchValue(values.transferlocation),
                'orderTypeId': 'TRANSFER_ORDER',
                'orderItemTypeId': 'PRODUCT_ORDER_ITEM',
                'itemStatusId': 'ITEM_CREATED',
                'orderDate': getSearchValue(values.formulatext),
                'productIdValue': getSearchValue(values.item),
                'productIdType': 'NETSUITE_PRODUCT_ID',
                'lineId': getSearchValue(values.transferorderitemline),
                'lineUniqueKey': lineUniqueKey,
                'quantity': currentQuantity,
                'unitListPrice': 0,
                'unitPrice': 0,
                'grandTotal': 0,
                'shipmentMethodTypeId': flowConfig.shipmentMethodTypeId,
                'carrierPartyId': '_NA_',
                'orderName': getSearchValue(values.tranid),
                'statusFlowId': flowConfig.statusFlowId
            };

            mapContext.write({
                key: internalId,
                value: transferOrderLineData
            });
        };

        const reduce = (reduceContext) => {
            let transferOrderMap = {
                shipGroups: []
            };

            let lineUpdates = [];

            reduceContext.values.forEach((value) => {
                const item = JSON.parse(value);

                if (!transferOrderMap.externalId) {
                    transferOrderMap = {
                        externalId: item.externalId,
                        orderName: item.orderName,
                        orderTypeId: item.orderTypeId,
                        shipGroups: [
                            {
                                facilityId: item.originFacilityExternalId,
                                orderFacilityExternalId: item.destinationLocationId,
                                items: []
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
                let exportedLineUpdates = [];
                let stageErrors = [];
                var totalRecordsExported = 0;

                summaryContext.mapSummary.errors.iterator().each(function (key, value) {
                    stageErrors.push('Map error for key ' + key + ': ' + value);
                    return true;
                });

                summaryContext.reduceSummary.errors.iterator().each(function (key, value) {
                    stageErrors.push('Reduce error for Transfer Order ' + key + ': ' + value);
                    return true;
                });

                if (stageErrors.length > 0) {
                    throw error.create({
                        name: 'TRANSFER_ORDER_DELTA_STAGE_ERROR',
                        message: stageErrors.join('\n')
                    });
                }

                summaryContext.output.iterator().each(function (key, value) {
                    var reduceOutput = JSON.parse(value);
                    result.push(reduceOutput.payload);
                    exportedLineUpdates.push({
                        transferOrderId: key,
                        lineUpdates: reduceOutput.lineUpdates
                    });
                    totalRecordsExported++;
                    return true;
                });

                log.debug('====totalRecordsExported==', totalRecordsExported);

                if (totalRecordsExported > 0) {
                    var scriptObj = runtime.getCurrentScript();
                    var flowConfig = getFlowConfig();
                    var filePrefix = scriptObj.getParameter({
                        name: 'custscript_hc_delta_file_prefix'
                    }) || flowConfig.defaultFilePrefix;

                    var fileName = filePrefix +
                        summaryContext.dateCreated.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') +
                        '.json';

                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.JSON,
                        contents: JSON.stringify(result, null, 2),
                        encoding: file.Encoding.UTF_8
                    });

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
                    var sftpDirectory = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_default_file_dir'
                    }) + 'transferorderv2';

                    var connection = sftp.createConnection({
                        username: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_userid' }),
                        secret: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_guid' }),
                        url: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_server' }),
                        port: parseInt(sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_port_no' })),
                        directory: sftpDirectory,
                        hostKey: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_host_key' })
                    });

                    log.debug('Connection established successfully with SFTP server!');

                    if (fileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                            name: 'FILE_IS_TOO_BIG',
                            message: 'The file you are trying to upload is too big'
                        });
                    }

                    connection.upload({
                        directory: '/import/transfer-order/update',
                        file: fileObj
                    });

                    log.audit({
                        title: 'Updated/new Transfer Order line JSON uploaded successfully',
                        details: {
                            fileName: fileName,
                            transferOrderCount: exportedLineUpdates.length
                        }
                    });

                    exportedLineUpdates.forEach((transferOrderUpdate) => {
                        updateExportedLineFields(
                            transferOrderUpdate.transferOrderId,
                            transferOrderUpdate.lineUpdates
                        );
                    });

                    log.debug('Updated/new Transfer Order line JSON uploaded successfully', fileName);
                }
            } catch (e) {
                log.error({
                    title: 'Error exporting updated/new Transfer Order lines',
                    details: e
                });

                throw error.create({
                    name: 'ERROR_EXPORTING_TRANSFER_ORDER_LINE_UPDATES',
                    message: e
                });
            }
        };

        return { getInputData, map, reduce, summarize };
    });