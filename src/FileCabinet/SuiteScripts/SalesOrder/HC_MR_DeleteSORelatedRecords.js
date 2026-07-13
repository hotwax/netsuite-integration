/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * This script deletes related records (Deposit Application, Invoice, Item Fulfillment)
 */

define(['N/record', 'N/search', 'N/log'],
    (record, search, log) => {

        /**
         * Marks the beginning of the Map/Reduce process and generates input data.
         *
         * @typedef {Object} ObjectRef
         * @property {number} id - Internal ID of the record instance
         * @property {string} type - Record type id
         *
         * @return {Array|Object|Search|RecordRef} inputSummary
         * @since 2015.1
         */
        const getInputData = (inputContext) => {
            // Hardcoded array of Sales Order Internal IDs to process
            const salesOrderIds = []
             log.audit('Input Data', 'Processing Sales Orders: ' + JSON.stringify(salesOrderIds));
            return salesOrderIds;
        };

        /**
         * Executes when the map entry point is triggered and applies to each key/value pair.
         *
         * @param {MapSummary} mapContext - Data collection containing the key/value pairs to process through the map stage
         * @since 2015.1
         */
        const map = (mapContext) => {
            const salesOrderId = mapContext.value;
            let hasError = false;

            try {
                let invoiceIds = [];
                let fulfillmentIds = [];

                // 1. Find Invoices
                search.create({
                    type: search.Type.INVOICE,
                    filters: [
                        ['createdfrom', 'anyof', salesOrderId],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['internalid']
                }).run().each(result => {
                    invoiceIds.push(result.id);
                    return true;
                });

                // 3. Find Item Fulfillments
                search.create({
                    type: search.Type.ITEM_FULFILLMENT,
                    filters: [
                        ['createdfrom', 'anyof', salesOrderId],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['internalid']
                }).run().each(result => {
                    fulfillmentIds.push(result.id);
                    return true;
                });
                // Delete Deposit Applications by checking Invoice links
                invoiceIds.forEach(invoiceId => {
                    try {
                        var invoiceRecord = record.load({
                            type: record.Type.INVOICE,
                            id: invoiceId,
                            isDynamic: false
                        });

                        var applyingTransactionCount = invoiceRecord.getLineCount({
                            sublistId: 'links'
                        });

                        for (var i = 0; i < applyingTransactionCount; i++) {
                            var linkType = invoiceRecord.getSublistValue({
                                sublistId: 'links',
                                fieldId: 'type',
                                line: i
                            });

                            if (linkType === 'Deposit Application') {
                                var depositAppId = invoiceRecord.getSublistValue({
                                    sublistId: 'links',
                                    fieldId: 'id',
                                    line: i
                                });

                                try {
                                    record.delete({
                                        type: record.Type.DEPOSIT_APPLICATION,
                                        id: depositAppId
                                    });
                                    log.audit('Deleted Deposit Application', depositAppId);
                                } catch (e) {
                                    hasError = true;
                                    log.error('Error deleting Deposit Application ' + depositAppId, e.message);
                                }
                            }
                        }
                    } catch (e) {
                        hasError = true;
                        log.error('Error loading invoice to delete Deposit Applications ' + invoiceId, e.message);
                    }
                });

                // Delete Invoices
                invoiceIds.forEach(id => {
                    try {
                        record.delete({ type: record.Type.INVOICE, id: id });
                        log.audit('Deleted Invoice', id);
                    } catch (e) {
                        hasError = true;
                        log.error('Error deleting Invoice ' + id, e.message);
                    }
                });

                // Delete Item Fulfillments
                fulfillmentIds.forEach(id => {
                    try {
                        record.delete({ type: record.Type.ITEM_FULFILLMENT, id: id });
                        log.audit('Deleted Item Fulfillment', id);
                    } catch (e) {
                        hasError = true;
                        log.error('Error deleting Item Fulfillment ' + id, e.message);
                    }
                });

                // --- Update Sales Order Phase ---
                try {
                    var soRec = record.load({
                        type: record.Type.SALES_ORDER,
                        id: salesOrderId,
                        isDynamic: true
                    });

                    var itemCount = soRec.getLineCount({ sublistId: 'item' });
                    var linesToRemove = [];
                    var seenLineIds = {};
                    var isModified = false;

                    for (var i = 0; i < itemCount; i++) {
                        var itemId = soRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                        var hcLineId = soRec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_hc_order_line_id', line: i });

                        // 1. Remove if item ID is 34838
                        if (String(itemId) === '34838') {
                            linesToRemove.push(i);
                            continue;
                        }

                        // 2. Remove duplicate line based on custom field
                        if (hcLineId) {
                            if (seenLineIds[hcLineId]) {
                                linesToRemove.push(i);
                            } else {
                                seenLineIds[hcLineId] = true;
                            }
                        }
                    }

                    log.debug('Lines Data for SO ' + salesOrderId, JSON.stringify({
                        linesToRemove: linesToRemove,
                        seenLineIds: seenLineIds
                    }));

                    if (linesToRemove.length > 0) {
                        // Remove lines from bottom to top so indices do not shift during removal
                        for (var j = linesToRemove.length - 1; j >= 0; j--) {
                            soRec.removeLine({
                                sublistId: 'item',
                                line: linesToRemove[j]
                            });
                        }
                        isModified = true;
                    }

                    if (isModified) {
                        soRec.save();
                        log.audit('Updated Sales Order', 'Removed ' + linesToRemove.length + ' lines from SO ' + salesOrderId);

                        // Reload the record to get updated totals for variance calculation
                        soRec = record.load({
                            type: record.Type.SALES_ORDER,
                            id: salesOrderId,
                            isDynamic: true
                        });
                    }

                    // 3. Add variance item logic
                    var totalNS = soRec.getValue({ fieldId: 'total' });
                    var totalHCOrder = soRec.getValue({ fieldId: 'custbody_hc_order_total' });
                    var offsetLineValue = 0;

                    if (totalNS && parseFloat(totalNS) > 0 && totalHCOrder && parseFloat(totalHCOrder) > 0) {
                        offsetLineValue = parseFloat(totalHCOrder) - parseFloat(totalNS);
                    }

                    if (offsetLineValue !== 0) {
                        var offsetLineValueAmount = offsetLineValue.toFixed(2);
                        var varianceItem = '34838';

                        soRec.selectNewLine({ sublistId: 'item' });
                        soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: varianceItem });
                        soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: "-1" });
                        soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: offsetLineValueAmount });
                        soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: "-7" });
                        soRec.commitLine({ sublistId: 'item' });

                        soRec.save();
                        log.audit('Updated Sales Order Variance', 'Variance added: Yes, SO: ' + salesOrderId);
                    } else {
                        if (!isModified) {
                            log.audit('No updates needed', 'SO ' + salesOrderId);
                        } else {
                            log.audit('Variance calculation', 'No variance added for SO: ' + salesOrderId);
                        }
                    }
                } catch (e) {
                    hasError = true;
                    log.error('Error updating Sales Order ' + salesOrderId, e.message);
                }

                if (hasError) {
                    mapContext.write({
                        key: 'Failed_Sales_Orders',
                        value: salesOrderId
                    });
                }

            } catch (e) {
                log.error('Unexpected error processing Sales Order ' + salesOrderId, e.message);
            }
        };

        /**
         * Executes when the summarize entry point is triggered and applies to the result set.
         *
         * @param {Summary} summary - Holds statistics regarding the execution of a map/reduce script
         * @since 2015.1
         */
        const summarize = (summaryContext) => {
            log.audit('Map/Reduce Script Complete', {
                usage: summaryContext.usage,
                concurrency: summaryContext.concurrency,
                yields: summaryContext.yields
            });

            if (summaryContext.inputSummary.error) {
                log.error('Input Error', summaryContext.inputSummary.error);
            }

            summaryContext.mapSummary.errors.iterator().each((key, error) => {
                log.error(`Map Error for key: ${key}`, error);
                return true;
            });

            // Log the final list of Sales Order internal IDs that had errors
            let failedSalesOrders = [];
            summaryContext.output.iterator().each((key, value) => {
                failedSalesOrders.push(value);
                return true;
            });

            if (failedSalesOrders.length > 0) {
                log.error('Final List of Sales Orders with Errors', JSON.stringify(failedSalesOrders));
            }
        };

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    }
);
