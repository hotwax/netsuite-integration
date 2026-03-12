/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/runtime'], (record, runtime) => {
    const CUSTOMER_FEED_COLUMNS = [
        'email', 'HCCustomerId', 'firstName', 'lastName', 'HCShopifyCustomerId',
        'individual', 'status', 'taxable', 'defaultOrderPriority', 'externalId',
        'phone', 'subsidiary', 'department'
    ];

    const ORDER_FEED_COLUMNS = [
        'date', 'country', 'orderId', 'exchangeCreditPayment', 'HCShopifySalesOrderId',
        'priceLevel', 'salesChannel', 'billingAddress2', 'billingAddress1', 'price',
        'billingCountry', 'tag', 'state', 'optionText', 'billingZip', 'zip', 'item',
        'shippingCost', 'giftWrapOption', 'departmentSO', 'shippingMethod',
        'billingState', 'itemLocation', 'taxCode', 'subsidiary', 'shippingTaxCode',
        'addressee', 'giftCardPaymentTotal', 'phone', 'billingAddressee', 'orderLineId',
        'optionFont', 'isGiftWrap', 'gorjanaSalesChannel', 'city', 'orderNote',
        'orderWithKitProduct', 'billingEmail', 'orderLineTypeId', 'shipBooklets',
        'department', 'email', 'GiftWraperText', 'quantity', 'address2', 'address1',
        'externalId', 'HCOrderTotal', 'finalSale', 'packingCategory', 'etailOrderId',
        'orderPaymentTotal', 'closed', 'location', 'HCOrderId', 'billingCity',
        'billingPhone', 'customer', 'createItemFulfillment'
    ];

    const SUPPORTED_CUSTOMER_COLUMNS = new Set([
        'internalId', 'companyName',
        'email', 'HCCustomerId', 'firstName', 'lastName', 'HCShopifyCustomerId',
        'individual', 'status', 'taxable', 'defaultOrderPriority', 'externalId',
        'phone', 'subsidiary', 'department'
    ]);

    const SUPPORTED_ORDER_COLUMNS = new Set([
        'date', 'country', 'orderId', 'exchangeCreditPayment', 'HCShopifySalesOrderId',
        'priceLevel', 'salesChannel', 'billingAddress2', 'billingAddress1', 'price',
        'billingCountry', 'tag', 'state', 'billingZip', 'zip', 'item', 'shippingCost',
        'departmentSO', 'shippingMethod', 'billingState', 'itemLocation', 'taxCode',
        'subsidiary', 'shippingTaxCode', 'addressee', 'phone', 'billingAddressee',
        'orderLineId', 'gorjanaSalesChannel', 'city', 'orderNote', 'orderLineTypeId',
        'department', 'email', 'quantity', 'address2', 'address1', 'externalId',
        'closed', 'location', 'HCOrderId', 'billingCity', 'billingPhone', 'billingEmail',
        'customer', 'rate',
        'items', 'orderLines', 'rows', 'customBodyFields', 'customLineFields', 'memo',
        'internalId', 'createItemFulfillment'
    ]);

    function post(requestBody) {
        const startedAt = Date.now();
        const script = runtime.getCurrentScript();
        const warnings = [];

        try {
            const payload = normalizePayload(requestBody || {});
            const requestId = payload.requestId || `restlet-${Date.now()}`;

            const ignoredCustomerColumns = getUnsupportedColumns(payload.customer, SUPPORTED_CUSTOMER_COLUMNS);
            const ignoredOrderColumns = getUnsupportedColumnsFromOrder(payload.salesOrder, SUPPORTED_ORDER_COLUMNS);

            let customerId = firstPresent(payload.customer, ['internalId']) || firstPresent(payload.salesOrder.header, ['customer']);
            let customerCreated = false;

            if (!isPresent(customerId)) {
                try {
                    customerId = createCustomer(payload.customer, warnings);
                    customerCreated = true;
                } catch (custErr) {
                    throw new Error(`[Customer Creation] ${custErr.message || String(custErr)}`);
                }
            }

            let salesOrderId;
            try {
                salesOrderId = createSalesOrder(customerId, payload.salesOrder, warnings);
            } catch (soErr) {
                throw new Error(`[Sales Order Creation] ${soErr.message || String(soErr)}`);
            }

            // Create an Item Fulfillment (IF) from the newly created SO by default.
            // Pass createItemFulfillment: false in the order header to skip this step.
            let itemFulfillmentId = null;
            const shouldCreateIF = parseBoolean(
                firstPresent(payload.salesOrder.header, ['createItemFulfillment'])
            ) !== false;  // null (not provided) and true both result in creation
            if (shouldCreateIF) {
                try {
                    itemFulfillmentId = createItemFulfillment(salesOrderId, warnings);
                } catch (ifErr) {
                    throw new Error(`[Item Fulfillment Creation] ${ifErr.message || String(ifErr)}`);
                }
            }

            return {
                success: true,
                requestId: requestId,
                customerCreated: customerCreated,
                customerId: customerId,
                salesOrderId: salesOrderId,
                itemFulfillmentId: itemFulfillmentId,
                ignoredCustomerColumns: ignoredCustomerColumns,
                ignoredOrderColumns: ignoredOrderColumns,
                elapsedMs: Date.now() - startedAt,
                remainingUsage: script.getRemainingUsage(),
                warnings: warnings
            };
        } catch (e) {
            return {
                success: false,
                errorName: e.name || 'ERROR',
                errorMessage: e.message || String(e),
                elapsedMs: Date.now() - startedAt,
                remainingUsage: script.getRemainingUsage(),
                warnings: warnings
            };
        }
    }

    function get(requestParams) {
        return {
            success: true,
            message: 'Create customer + sales order RESTlet. Pass createItemFulfillment:true in the order header to also create an Item Fulfillment (IF) from the new SO.',
            supportedCustomerFeedColumns: CUSTOMER_FEED_COLUMNS,
            supportedOrderFeedColumns: ORDER_FEED_COLUMNS
        };
    }

    function normalizePayload(body) {
        const customerFeed = asObject(body.customerFeed);
        const customer = asObject(body.customer);
        const normalizedCustomer = mergeObjects(customerFeed, customer);

        const orderFeedInput = body.orderFeed;
        const salesOrderInput = asObject(body.salesOrder);

        const orderHeader = mergeObjects(
            stripLineCollections(asObject(getOrderHeader(orderFeedInput))),
            stripLineCollections(salesOrderInput)
        );

        const lineRows = getOrderLineRows(orderFeedInput, salesOrderInput);

        return {
            requestId: body.requestId,
            customer: normalizedCustomer,
            salesOrder: {
                header: orderHeader,
                lines: lineRows
            }
        };
    }

    function createCustomer(customerInput, warnings) {
        const rec = record.create({
            type: record.Type.CUSTOMER,
            isDynamic: true
        });

        const firstName = firstPresent(customerInput, ['firstName']);
        const lastName = firstPresent(customerInput, ['lastName']);
        const email = firstPresent(customerInput, ['email']);

        const individualRaw = firstPresent(customerInput, ['individual']);
        let isPerson = parseBoolean(individualRaw);
        if (isPerson === null && (isPresent(firstName) || isPresent(lastName))) {
            isPerson = true;
        }
        if (isPerson !== null) {
            safeSetFieldValue(rec, 'isperson', isPerson ? 'T' : 'F', warnings, 'individual');
        }

        safeSetFieldValueOrText(rec, 'externalid', firstPresent(customerInput, ['externalId']), warnings, 'externalId');
        safeSetFieldValueOrText(rec, 'subsidiary', firstPresent(customerInput, ['subsidiary']), warnings, 'subsidiary');
        
        const deptValue = firstPresent(customerInput, ['department', 'departmentSO']);
        if (isPresent(deptValue)) {
            safeSetFieldValueOrText(rec, 'department', deptValue, warnings, 'department');
        }
        safeSetFieldValue(rec, 'email', email, warnings, 'email');
        safeSetFieldValue(rec, 'phone', firstPresent(customerInput, ['phone']), warnings, 'phone');
        safeSetFieldValue(rec, 'firstname', firstName, warnings, 'firstName');
        safeSetFieldValue(rec, 'lastname', lastName, warnings, 'lastName');
        safeSetFieldValue(rec, 'custentity_hc_customer_id', firstPresent(customerInput, ['HCCustomerId']), warnings, 'HCCustomerId');
        safeSetFieldValue(rec, 'custentity_hc_shop_cust_id', firstPresent(customerInput, ['HCShopifyCustomerId']), warnings, 'HCShopifyCustomerId');
        safeSetFieldValueOrText(rec, 'entitystatus', firstPresent(customerInput, ['status']), warnings, 'status');
        safeSetFieldValueOrText(rec, 'defaultorderpriority', firstPresent(customerInput, ['defaultOrderPriority']), warnings, 'defaultOrderPriority');

        const taxable = parseBoolean(firstPresent(customerInput, ['taxable']));
        if (taxable !== null) {
            safeSetFieldValue(rec, 'taxable', taxable, warnings, 'taxable');
        }

        if (isPerson === false) {
            const companyName = firstPresent(customerInput, ['companyName']) ||
                [firstName, lastName].filter(isPresent).join(' ').trim() ||
                email ||
                firstPresent(customerInput, ['externalId']);
            safeSetFieldValue(rec, 'companyname', companyName, warnings, 'companyName');
        }

        return rec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    function createSalesOrder(customerId, salesOrderInput, warnings) {
        const header = asObject(salesOrderInput.header);
        const lines = Array.isArray(salesOrderInput.lines) ? salesOrderInput.lines : [];

        const rec = record.create({
            type: record.Type.SALES_ORDER,
            isDynamic: true
        });

        safeSetFieldValueOrText(rec, 'entity', customerId, warnings, 'customer');
        safeSetFieldValueOrText(rec, 'externalid', firstPresent(header, ['externalId']), warnings, 'externalId');
        safeSetFieldValueOrText(rec, 'subsidiary', firstPresent(header, ['subsidiary']), warnings, 'subsidiary');
        safeSetFieldValueOrText(rec, 'location', firstPresent(header, ['location']), warnings, 'location');
        safeSetFieldValue(rec, 'memo', firstPresent(header, ['orderNote', 'memo']), warnings, 'orderNote');
        safeSetFieldValue(rec, 'otherrefnum', firstPresent(header, ['orderId']), warnings, 'orderId');
        safeSetFieldValue(rec, 'email', firstPresent(header, ['email', 'billingEmail']), warnings, 'email');

        const trandate = parseDate(firstPresent(header, ['date']));
        if (trandate) {
            safeSetFieldValue(rec, 'trandate', trandate, warnings, 'date');
        }

        safeSetFieldValue(rec, 'custbody_hc_sales_channel', firstPresent(header, ['salesChannel', 'gorjanaSalesChannel']), warnings, 'salesChannel');
        safeSetFieldValue(rec, 'custbody_hc_shopify_order_id', firstPresent(header, ['HCShopifySalesOrderId']), warnings, 'HCShopifySalesOrderId');
        safeSetFieldValue(rec, 'custbody_hc_order_id', firstPresent(header, ['HCOrderId']), warnings, 'HCOrderId');
        safeSetFieldValue(rec, 'custbody_hc_pos_exc_payment', firstPresent(header, ['exchangeCreditPayment']), warnings, 'exchangeCreditPayment');

        const deptValueSO = firstPresent(header, ['departmentSO', 'department']);
        safeSetFieldValueOrText(rec, 'department', deptValueSO, warnings, 'departmentSO');
        
        // Explicitly check if it was set properly on SO
        if (isPresent(deptValueSO)) {
            const actualDeptSO = rec.getValue({ fieldId: 'department' });
            if (!actualDeptSO) {
                warnings.push(`departmentSO: Attempted to set to '${deptValueSO}', but NetSuite ignored it on Sales Order. (Check if '${deptValueSO}' is inactive or unassigned to Subsidiary)`);
            }
        }
        safeSetFieldValueOrText(rec, 'shipmethod', firstPresent(header, ['shippingMethod']), warnings, 'shippingMethod');
        safeSetFieldValue(rec, 'shippingcost', parseNumber(firstPresent(header, ['shippingCost'])), warnings, 'shippingCost');
        safeSetFieldValueOrText(rec, 'shippingtaxcode', firstPresent(header, ['shippingTaxCode']), warnings, 'shippingTaxCode');

        setAddress(rec, 'shippingaddress', {
            addressee: firstPresent(header, ['addressee']),
            addr1: firstPresent(header, ['address1']),
            addr2: firstPresent(header, ['address2']),
            city: firstPresent(header, ['city']),
            state: firstPresent(header, ['state']),
            zip: firstPresent(header, ['zip']),
            country: firstPresent(header, ['country']),
            addrphone: firstPresent(header, ['phone'])
        }, warnings, 'shippingAddress');

        setAddress(rec, 'billingaddress', {
            addressee: firstPresent(header, ['billingAddressee']),
            addr1: firstPresent(header, ['billingAddress1']),
            addr2: firstPresent(header, ['billingAddress2']),
            city: firstPresent(header, ['billingCity']),
            state: firstPresent(header, ['billingState']),
            zip: firstPresent(header, ['billingZip']),
            country: firstPresent(header, ['billingCountry']),
            addrphone: firstPresent(header, ['billingPhone'])
        }, warnings, 'billingAddress');

        const customBodyFields = asObject(header.customBodyFields);
        Object.keys(customBodyFields).forEach(fieldId => {
            safeSetFieldValueOrText(rec, fieldId, customBodyFields[fieldId], warnings, `customBodyFields.${fieldId}`);
        });

        const validLines = lines.filter(line => isPresent(firstPresentFromSources([line, header], ['item'])));
        if (!validLines.length) {
            throw new Error('orderFeed/items must contain at least one line with item');
        }

        validLines.forEach((line, index) => {
            rec.selectNewLine({ sublistId: 'item' });

            safeSetCurrentLineValueOrText(rec, 'item', 'item', firstPresentFromSources([line, header], ['item']), warnings, `item.line.${index + 1}.item`);
            safeSetCurrentLineValue(
                rec,
                'item',
                'quantity',
                parseNumber(firstPresentFromSources([line, header], ['quantity'])) || 1,
                warnings,
                `item.line.${index + 1}.quantity`
            );
            safeSetCurrentLineValueOrText(rec, 'item', 'price', firstPresentFromSources([line, header], ['priceLevel']), warnings, `item.line.${index + 1}.priceLevel`);
            safeSetCurrentLineValue(rec, 'item', 'rate', parseNumber(firstPresentFromSources([line, header], ['price', 'rate'])), warnings, `item.line.${index + 1}.price`);
            safeSetCurrentLineValueOrText(rec, 'item', 'location', firstPresentFromSources([line, header], ['itemLocation']), warnings, `item.line.${index + 1}.itemLocation`);
            safeSetCurrentLineValueOrText(rec, 'item', 'taxcode', firstPresentFromSources([line, header], ['taxCode']), warnings, `item.line.${index + 1}.taxCode`);
            safeSetCurrentLineValue(rec, 'item', 'custcol_hc_item_tag', firstPresentFromSources([line, header], ['tag']), warnings, `item.line.${index + 1}.tag`);
            safeSetCurrentLineValue(rec, 'item', 'custcol_hc_order_line_id', firstPresentFromSources([line, header], ['orderLineId']), warnings, `item.line.${index + 1}.orderLineId`);
            safeSetCurrentLineValue(rec, 'item', 'custcol_hc_orderline_type_id', firstPresentFromSources([line, header], ['orderLineTypeId']), warnings, `item.line.${index + 1}.orderLineTypeId`);

            const lineClosed = parseBoolean(firstPresentFromSources([line, header], ['closed']));
            if (lineClosed !== null) {
                safeSetCurrentLineValue(rec, 'item', 'isclosed', lineClosed, warnings, `item.line.${index + 1}.closed`);
            }

            const customLineFields = asObject(line.customLineFields);
            Object.keys(customLineFields).forEach(fieldId => {
                safeSetCurrentLineValueOrText(
                    rec,
                    'item',
                    fieldId,
                    customLineFields[fieldId],
                    warnings,
                    `item.line.${index + 1}.customLineFields.${fieldId}`
                );
            });

            rec.commitLine({ sublistId: 'item' });
        });

        return rec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    /**
     * Transforms a Sales Order into an Item Fulfillment.
     * All lines that are fulfillable are marked for receipt and the record is saved.
     *
     * @param {number} salesOrderId - Internal ID of the Sales Order to fulfil.
     * @param {Array}  warnings     - Warnings array shared with the caller.
     * @returns {number} Internal ID of the created Item Fulfillment.
     */
    function createItemFulfillment(salesOrderId, warnings) {
        const ifRec = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: salesOrderId,
            toType: record.Type.ITEM_FULFILLMENT,
            isDynamic: true
        });

        // Force every SO line into the fulfillment — NetSuite defaults itemreceive
        // to false on the transformed record, so we explicitly flip each line to true.
        const lineCount = ifRec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) {
            ifRec.selectLine({ sublistId: 'item', line: i });
            ifRec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                value: true
            });
            ifRec.commitLine({ sublistId: 'item' });
        }

        return ifRec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    function setAddress(rec, fieldId, addressValues, warnings, sourcePrefix) {
        if (!hasAnyValue(addressValues)) {
            return;
        }

        const listFieldId = fieldId === 'shippingaddress' ? 'shipaddresslist' : 'billaddresslist';
        safeSetFieldValueOrText(rec, listFieldId, -2, warnings, `${sourcePrefix}.addressList`);

        let addressRec;
        try {
            addressRec = rec.getSubrecord({ fieldId: fieldId });
        } catch (e) {
            warnings.push(`${sourcePrefix}: unable to access subrecord (${e.message})`);
            return;
        }

        safeSetFieldValueOrText(addressRec, 'addressee', addressValues.addressee, warnings, `${sourcePrefix}.addressee`);
        safeSetFieldValueOrText(addressRec, 'addr1', addressValues.addr1, warnings, `${sourcePrefix}.address1`);
        safeSetFieldValueOrText(addressRec, 'addr2', addressValues.addr2, warnings, `${sourcePrefix}.address2`);
        safeSetFieldValueOrText(addressRec, 'city', addressValues.city, warnings, `${sourcePrefix}.city`);
        safeSetFieldValueOrText(addressRec, 'state', addressValues.state, warnings, `${sourcePrefix}.state`);
        safeSetFieldValueOrText(addressRec, 'zip', addressValues.zip, warnings, `${sourcePrefix}.zip`);
        safeSetFieldValueOrText(addressRec, 'country', addressValues.country, warnings, `${sourcePrefix}.country`);
        safeSetFieldValueOrText(addressRec, 'addrphone', addressValues.addrphone, warnings, `${sourcePrefix}.phone`);
    }

    function safeSetFieldValue(rec, fieldId, value, warnings, sourceColumn) {
        if (!isPresent(value)) {
            return;
        }
        try {
            rec.setValue({ fieldId: fieldId, value: value });
        } catch (e) {
            warnings.push(`${sourceColumn} -> ${fieldId}: ${e.message}`);
        }
    }

    function safeSetFieldValueOrText(rec, fieldId, value, warnings, sourceColumn) {
        if (!isPresent(value)) {
            return;
        }
        try {
            rec.setValue({ fieldId: fieldId, value: value });
            return;
        } catch (valueError) {
            try {
                rec.setText({ fieldId: fieldId, text: String(value) });
                return;
            } catch (textError) {
                warnings.push(`${sourceColumn} -> ${fieldId}: ${textError.message}`);
            }
        }
    }

    function safeSetCurrentLineValue(rec, sublistId, fieldId, value, warnings, sourceColumn) {
        if (!isPresent(value)) {
            return;
        }
        try {
            rec.setCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value
            });
        } catch (e) {
            warnings.push(`${sourceColumn} -> ${fieldId}: ${e.message}`);
        }
    }

    function safeSetCurrentLineValueOrText(rec, sublistId, fieldId, value, warnings, sourceColumn) {
        if (!isPresent(value)) {
            return;
        }
        try {
            rec.setCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value
            });
            return;
        } catch (valueError) {
            try {
                rec.setCurrentSublistText({
                    sublistId: sublistId,
                    fieldId: fieldId,
                    text: String(value)
                });
                return;
            } catch (textError) {
                warnings.push(`${sourceColumn} -> ${fieldId}: ${textError.message}`);
            }
        }
    }

    function getOrderHeader(orderFeedInput) {
        if (Array.isArray(orderFeedInput)) {
            return orderFeedInput.length ? asObject(orderFeedInput[0]) : {};
        }
        return asObject(orderFeedInput);
    }

    function getOrderLineRows(orderFeedInput, salesOrderInput) {
        if (Array.isArray(salesOrderInput.items) && salesOrderInput.items.length) {
            return salesOrderInput.items;
        }
        if (Array.isArray(salesOrderInput.orderLines) && salesOrderInput.orderLines.length) {
            return salesOrderInput.orderLines;
        }
        if (Array.isArray(salesOrderInput.rows) && salesOrderInput.rows.length) {
            return salesOrderInput.rows;
        }
        if (Array.isArray(orderFeedInput)) {
            return orderFeedInput;
        }
        const orderFeedObj = asObject(orderFeedInput);
        if (Array.isArray(orderFeedObj.items) && orderFeedObj.items.length) {
            return orderFeedObj.items;
        }
        if (Array.isArray(orderFeedObj.orderLines) && orderFeedObj.orderLines.length) {
            return orderFeedObj.orderLines;
        }
        if (Array.isArray(orderFeedObj.rows) && orderFeedObj.rows.length) {
            return orderFeedObj.rows;
        }
        const orderLine = asObject(orderFeedInput);
        return Object.keys(orderLine).length ? [orderLine] : [];
    }

    function stripLineCollections(value) {
        const obj = asObject(value);
        const clone = Object.assign({}, obj);
        delete clone.items;
        delete clone.orderLines;
        delete clone.rows;
        return clone;
    }

    function mergeObjects(first, second) {
        return Object.assign({}, asObject(first), asObject(second));
    }

    function asObject(value) {
        if (!value || Array.isArray(value) || typeof value !== 'object') {
            return {};
        }
        return value;
    }

    function firstPresent(source, keys) {
        if (!source || typeof source !== 'object') {
            return null;
        }
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (Object.prototype.hasOwnProperty.call(source, key) && isPresent(source[key])) {
                return source[key];
            }
        }
        return null;
    }

    function firstPresentFromSources(sources, keys) {
        for (let i = 0; i < sources.length; i += 1) {
            const value = firstPresent(sources[i], keys);
            if (isPresent(value)) {
                return value;
            }
        }
        return null;
    }

    function isPresent(value) {
        return value !== null && value !== undefined && value !== '';
    }

    function hasAnyValue(obj) {
        return Object.keys(asObject(obj)).some(key => isPresent(obj[key]));
    }

    function parseDate(value) {
        if (!isPresent(value)) {
            return null;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function parseNumber(value) {
        if (!isPresent(value)) {
            return null;
        }
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function parseBoolean(value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            if (value === 1) {
                return true;
            }
            if (value === 0) {
                return false;
            }
            return null;
        }
        if (typeof value !== 'string') {
            return null;
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === 't' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === 'f' || normalized === 'no' || normalized === 'n' || normalized === '0') {
            return false;
        }
        return null;
    }

    function getUnsupportedColumns(obj, supportedSet) {
        const data = asObject(obj);
        return Object.keys(data).filter(key => !supportedSet.has(key));
    }

    function getUnsupportedColumnsFromOrder(orderData, supportedSet) {
        const header = asObject(orderData.header);
        const lines = Array.isArray(orderData.lines) ? orderData.lines : [];
        const columns = new Set(Object.keys(header));
        lines.forEach(line => {
            Object.keys(asObject(line)).forEach(key => columns.add(key));
        });
        return Array.from(columns).filter(key => !supportedSet.has(key));
    }

    return { get, post };
});
