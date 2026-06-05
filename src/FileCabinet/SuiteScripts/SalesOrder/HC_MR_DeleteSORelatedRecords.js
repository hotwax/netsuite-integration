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
            const salesOrderIds = [];
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

                // Delete Customer Deposits
                depositIds.forEach(id => {
                    try {
                        // Step 1: Proactively check if it's linked to a Bank Deposit
                        let bankDepositIds = [];
                        search.create({
                            type: search.Type.DEPOSIT,
                            filters: [['appliedtotransaction', 'anyof', id]],
                            columns: ['internalid']
                        }).run().each(result => {
                            bankDepositIds.push(result.id);
                            return true;
                        });

                        // Step 2: If linked, unlink it first
                        if (bankDepositIds.length > 0) {
                            bankDepositIds.forEach(bdId => {
                                var depositRec = record.load({ type: record.Type.DEPOSIT, id: bdId, isDynamic: true });
                                var paymentCount = depositRec.getLineCount({ sublistId: 'payment' });
                                var isModified = false;

                                for (var i = 0; i < paymentCount; i++) {
                                    depositRec.selectLine({ sublistId: 'payment', line: i });
                                    var paymentId = depositRec.getCurrentSublistValue({ sublistId: 'payment', fieldId: 'id' });

                                    if (String(paymentId) === String(id)) {
                                        var isDeposited = depositRec.getCurrentSublistValue({ sublistId: 'payment', fieldId: 'deposit' });
                                        if (isDeposited === true || isDeposited === 'T') {
                                            depositRec.setCurrentSublistValue({ sublistId: 'payment', fieldId: 'deposit', value: false });
                                            depositRec.commitLine({ sublistId: 'payment' });
                                            isModified = true;
                                            log.audit('Unlinked Customer Deposit ' + paymentId + ' from Bank Deposit', bdId);
                                        }
                                        // Since a Customer Deposit can only appear once in a Bank Deposit, we can break the loop
                                        break;
                                    }
                                }

                                if (isModified) {
                                    depositRec.save();
                                }
                            });
                        }

                        // Step 3: Safely delete the Customer Deposit
                        record.delete({ type: record.Type.CUSTOMER_DEPOSIT, id: id });
                        log.audit('Deleted Customer Deposit', id);

                    } catch (e) {
                        hasError = true;
                        log.error('Error deleting Customer Deposit ' + id, e.message);
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

                // Delete Sales Order
                try {
                    record.delete({ type: record.Type.SALES_ORDER, id: salesOrderId });
                    log.audit('Deleted Sales Order', salesOrderId);
                } catch (e) {
                    hasError = true;
                    log.error('Error deleting Sales Order ' + salesOrderId, e.message);
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
