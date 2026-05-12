/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * This script deletes related records (Deposit Application, Invoice, Customer Deposit, Item Fulfillment)
 * for a specific list of Sales Orders.
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
            const salesOrderIds = [70299655, 70299150];
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
            log.debug('Processing Sales Order', salesOrderId);

            try {
                let invoiceIds = [];
                let depositIds = [];
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
                log.debug('Found Invoices', invoiceIds);

                // 2. Find Customer Deposits
                search.create({
                    type: search.Type.CUSTOMER_DEPOSIT,
                    filters: [
                        ['salesorder', 'anyof', salesOrderId],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['internalid']
                }).run().each(result => {
                    depositIds.push(result.id);
                    return true;
                });
                log.debug('Found Customer Deposits', depositIds);

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
                log.debug('Found Item Fulfillments', fulfillmentIds);

                // --- Deletion Phase ---
                // Order: Deposit Application -> Invoice -> Customer Deposit -> Item Fulfillment

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
                                log.debug({
                                    title: "depositAppId",
                                    details: depositAppId
                                });

                                try {
                                    record.delete({
                                        type: record.Type.DEPOSIT_APPLICATION,
                                        id: depositAppId
                                    });
                                    log.audit('Deleted Deposit Application', depositAppId);
                                } catch (e) {
                                    log.error('Error deleting Deposit Application ' + depositAppId, e.message);
                                }
                            }
                        }
                    } catch (e) {
                        log.error('Error loading invoice to delete Deposit Applications ' + invoiceId, e.message);
                    }
                });

                // Delete Invoices
                invoiceIds.forEach(id => {
                    try {
                        record.delete({ type: record.Type.INVOICE, id: id });
                        log.audit('Deleted Invoice', id);
                    } catch (e) {
                        log.error('Error deleting Invoice ' + id, e.message);
                    }
                });

                // Delete Customer Deposits
                depositIds.forEach(id => {
                    try {
                        record.delete({ type: record.Type.CUSTOMER_DEPOSIT, id: id });
                        log.audit('Deleted Customer Deposit', id);
                    } catch (e) {
                        log.error('Error deleting Customer Deposit ' + id, e.message);
                    }
                });

                // Delete Item Fulfillments
                fulfillmentIds.forEach(id => {
                    try {
                        record.delete({ type: record.Type.ITEM_FULFILLMENT, id: id });
                        log.audit('Deleted Item Fulfillment', id);
                    } catch (e) {
                        log.error('Error deleting Item Fulfillment ' + id, e.message);
                    }
                });

                // Delete Sales Order
                try {
                    record.delete({ type: record.Type.SALES_ORDER, id: salesOrderId });
                    log.audit('Deleted Sales Order', salesOrderId);
                } catch (e) {
                    log.error('Error deleting Sales Order ' + salesOrderId, e.message);
                }

            } catch (e) {
                log.error('Error processing Sales Order ' + salesOrderId, e.message);
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
        };

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    }
);
