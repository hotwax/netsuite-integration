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
        const so = body.salesOrder;
        const c = body.customer;

        try {
            // --- Customer ---
            let customerId = c.internalId;
            if (!customerId) {
                const custRec = record.create({ type: record.Type.CUSTOMER, isDynamic: true });
                custRec.setValue({ fieldId: 'isperson',   value: 'T' });
                custRec.setValue({ fieldId: 'firstname',  value: c.firstName });
                custRec.setValue({ fieldId: 'lastname',   value: c.lastName });
                custRec.setValue({ fieldId: 'email',      value: c.email });
                custRec.setValue({ fieldId: 'phone',      value: c.phone });
                custRec.setValue({ fieldId: 'subsidiary', value: c.subsidiary });
                custRec.setValue({ fieldId: 'externalid', value: c.externalId });
                customerId = custRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
            }

            // --- Sales Order ---
            const soRec = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
            soRec.setValue({ fieldId: 'entity',                       value: customerId });
            soRec.setValue({ fieldId: 'externalid',                   value: so.externalId });
            soRec.setValue({ fieldId: 'subsidiary',                   value: so.subsidiary });
            soRec.setValue({ fieldId: 'location',                     value: so.location });
            soRec.setValue({ fieldId: 'department',                   value: so.department });
            if (so.date) soRec.setValue({ fieldId: 'trandate',        value: new Date(so.date) });
            soRec.setValue({ fieldId: 'otherrefnum',                  value: so.orderId });
            soRec.setValue({ fieldId: 'memo',                         value: so.memo });
            soRec.setValue({ fieldId: 'email',                        value: so.email });
            soRec.setValue({ fieldId: 'custbody_hc_sales_channel',    value: so.salesChannel });
            soRec.setValue({ fieldId: 'custbody_hc_shopify_order_id', value: so.HCShopifySalesOrderId });
            soRec.setValue({ fieldId: 'custbody_hc_order_id',         value: so.HCOrderId });

            so.items.forEach(line => {
                soRec.selectNewLine({ sublistId: 'item' });
                soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item',                       value: line.item });
                soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity',                   value: line.quantity });
                soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate',                       value: line.rate });
                if (line.location)    soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location',                  value: line.location });
                if (line.taxCode)     soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode',                   value: line.taxCode });
                if (line.orderLineId) soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_hc_order_line_id',  value: line.orderLineId });
                soRec.commitLine({ sublistId: 'item' });
            });

            const salesOrderId = soRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

            // --- Item Fulfillment ---
            const ifRec = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: salesOrderId,
                toType: record.Type.ITEM_FULFILLMENT,
                isDynamic: true
            });
            const lineCount = ifRec.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                ifRec.selectLine({ sublistId: 'item', line: i });
                ifRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
                ifRec.commitLine({ sublistId: 'item' });
            }
            const itemFulfillmentId = ifRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

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
                title: `SalesOrder [ExternalID: ${so.externalId}] - POS completed order creation failed`,
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

    return { post };
});
