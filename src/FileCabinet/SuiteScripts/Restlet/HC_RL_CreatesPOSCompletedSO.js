/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * HC_RL_CreatesPOSCompletedSO
 *
 * Contract — POST body:
 * {
 *   customer: {
 *     internalId: "123"            // use existing customer  OR
 *     firstName, lastName, email,  // create a new customer
 *     phone, externalId, subsidiary
 *   },
 *   salesOrder: {
 *     externalId, subsidiary, location, department,
 *     date, orderId, memo, email,
 *     salesChannel, HCShopifySalesOrderId, HCOrderId,
 *     items: [{ item, quantity, rate, location, taxCode, orderLineId }]
 *   }
 * }
 *
 * Always creates: Customer (if no internalId) → Sales Order → Item Fulfillment (all lines)
 * Returns: { success, customerId, salesOrderId, itemFulfillmentId }
 */
define(['N/record', 'N/runtime', 'N/log'], (record, runtime, log) => {

    function post(body) {
        const startedAt = Date.now();
        const script = runtime.getCurrentScript();
        const externalId = (body.salesOrder || {}).externalId || 'unknown';
        try {
            const customerId = body.customer.internalId || createCustomer(body.customer);
            const salesOrderId = createSalesOrder(customerId, body.salesOrder);
            const itemFulfillmentId = createItemFulfillment(salesOrderId, externalId);
            return {
                success: true,
                customerId,
                salesOrderId,
                itemFulfillmentId,
                elapsedMs: Date.now() - startedAt,
                remainingUsage: script.getRemainingUsage()
            };
        } catch (e) {
            log.error({
                title: `SalesOrder [ExternalID: ${externalId}] - POS completed order creation failed`,
                details: e.message
            });
            return {
                success: false,
                errorName: e.name,
                errorMessage: e.message,
                elapsedMs: Date.now() - startedAt,
                remainingUsage: script.getRemainingUsage()
            };
        }
    }

    function createCustomer(c) {
        try {
            const rec = record.create({ type: record.Type.CUSTOMER, isDynamic: true });
            rec.setValue({ fieldId: 'isperson', value: 'T' });
            rec.setValue({ fieldId: 'firstname', value: c.firstName });
            rec.setValue({ fieldId: 'lastname', value: c.lastName });
            rec.setValue({ fieldId: 'email', value: c.email });
            rec.setValue({ fieldId: 'phone', value: c.phone });
            rec.setValue({ fieldId: 'subsidiary', value: c.subsidiary });
            rec.setValue({ fieldId: 'externalid', value: c.externalId });
            return rec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        } catch (e) {
            log.error({
                title: `Customer [ExternalID: ${c.externalId}] - Creation failed`,
                details: e.message
            });
            throw new Error(`Customer [ExternalID: ${c.externalId}] - Creation failed: ${e.message}`);
        }
    }

    function createSalesOrder(customerId, so) {
        try {
            const rec = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
            rec.setValue({ fieldId: 'entity', value: customerId });
            rec.setValue({ fieldId: 'externalid', value: so.externalId });
            rec.setValue({ fieldId: 'subsidiary', value: so.subsidiary });
            rec.setValue({ fieldId: 'location', value: so.location });
            rec.setValue({ fieldId: 'department', value: so.department });
            if (so.date) rec.setValue({ fieldId: 'trandate', value: new Date(so.date) });
            rec.setValue({ fieldId: 'otherrefnum', value: so.orderId });
            rec.setValue({ fieldId: 'memo', value: so.memo });
            rec.setValue({ fieldId: 'email', value: so.email });
            rec.setValue({ fieldId: 'custbody_hc_sales_channel', value: so.salesChannel });
            rec.setValue({ fieldId: 'custbody_hc_shopify_order_id', value: so.HCShopifySalesOrderId });
            rec.setValue({ fieldId: 'custbody_hc_order_id', value: so.HCOrderId });

            so.items.forEach(line => {
                rec.selectNewLine({ sublistId: 'item' });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: line.item });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: line.quantity });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: line.rate });
                if (line.location) rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: line.location });
                if (line.taxCode) rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: line.taxCode });
                if (line.orderLineId) rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_hc_order_line_id', value: line.orderLineId });
                rec.commitLine({ sublistId: 'item' });
            });

            return rec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        } catch (e) {
            log.error({
                title: `SalesOrder [ExternalID: ${so.externalId}, CustomerID: ${customerId}] - Creation failed`,
                details: e.message
            });
            throw new Error(`SalesOrder [ExternalID: ${so.externalId}, CustomerID: ${customerId}] - Creation failed: ${e.message}`);
        }
    }

    function createItemFulfillment(salesOrderId, externalId) {
        try {
            const rec = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: salesOrderId,
                toType: record.Type.ITEM_FULFILLMENT,
                isDynamic: true
            });
            const lineCount = rec.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                rec.selectLine({ sublistId: 'item', line: i });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
                rec.commitLine({ sublistId: 'item' });
            }
            return rec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        } catch (e) {
            log.error({
                title: `ItemFulfillment [SalesOrderID: ${salesOrderId}, ExternalID: ${externalId}] - Creation failed`,
                details: e.message
            });
            throw new Error(`ItemFulfillment [SalesOrderID: ${salesOrderId}, ExternalID: ${externalId}] - Creation failed: ${e.message}`);
        }
    }

    return { post };
});
