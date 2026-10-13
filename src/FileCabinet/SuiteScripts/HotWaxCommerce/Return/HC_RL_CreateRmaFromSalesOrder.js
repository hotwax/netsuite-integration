/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/file', 'N/error', 'N/log'], (record, search, file, error, log) => {

  function get() {
    return file.load({ id: './HC_RL_CreateRmaFromSalesOrder.openapi.json' }).getContents();
  }

  function post(body) {
    const { salesOrderId, replace, item, entity, shippingAddress, billingAddress, ...header } = body;
    const lines = (item && item.items) || [];
    const missingFields = ['salesOrderId', 'externalId'].filter((name) => !body[name]);
    const missingLines = [];
    let rmaId = null;
    let existing = false;
    let closedLines = 0;
    let errorName;

    try {
      if (missingFields.length) {
        throw error.create({ name: 'MISSING_FIELD', message: 'salesOrderId and externalId are required' });
      }

      const found = search.create({
        type: search.Type.RETURN_AUTHORIZATION,
        filters: [['externalid', 'is', body.externalId], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid']
      }).run().getRange({ start: 0, end: 1 });
      existing = found.length > 0;

      if (existing) {
        rmaId = String(found[0].getValue('internalid'));
      } else {
        const rma = record.transform({
          fromType: record.Type.SALES_ORDER, fromId: salesOrderId, toType: record.Type.RETURN_AUTHORIZATION, isDynamic: true
        });
        if (replace === 'item') {
          for (let line = rma.getLineCount({ sublistId: 'item' }) - 1; line >= 0; line--) {
            rma.removeLine({ sublistId: 'item', line, ignoreRecalc: true });
          }
        }

        if (entity && String(entity.id) !== String(rma.getValue({ fieldId: 'entity' }))) {
          rma.setValue({ fieldId: 'entity', value: entity.id });
        }
        Object.keys(header).forEach((name) => {
          const fieldId = name.toLowerCase();
          rma.setValue({ fieldId, value: valueFor(rma.getField({ fieldId }), header[name]) });
        });

        lines.forEach((line) => {
          rma.selectNewLine({ sublistId: 'item' });
          const lineIndex = rma.getCurrentSublistIndex({ sublistId: 'item' });
          rma.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: line.item.id });
          Object.keys(line).filter((name) => name !== 'item' && name !== 'isClosed').forEach((name) => {
            const fieldId = name.toLowerCase();
            const field = rma.getSublistField({ sublistId: 'item', fieldId, line: lineIndex });
            rma.setCurrentSublistValue({ sublistId: 'item', fieldId, value: valueFor(field, line[name]) });
          });
          rma.commitLine({ sublistId: 'item' });
        });

        [['shippingaddress', shippingAddress], ['billingaddress', billingAddress]].filter(([, address]) => address).forEach(([fieldId, address]) => {
          const subrecord = rma.getSubrecord({ fieldId });
          const { country, ...addressFields } = address;
          if (country) subrecord.setValue({ fieldId: 'country', value: country });
          Object.keys(addressFields).forEach((name) => subrecord.setValue({ fieldId: name.toLowerCase(), value: addressFields[name] }));
        });
        rmaId = String(rma.save());
      }

      if (lines.some((line) => line.isClosed === true)) {
        const saved = record.load({ type: record.Type.RETURN_AUTHORIZATION, id: rmaId, isDynamic: false });
        const unpaired = [];
        for (let line = saved.getLineCount({ sublistId: 'item' }) - 1; line >= 0; line--) {
          unpaired.push({
            line,
            item: String(saved.getSublistValue({ sublistId: 'item', fieldId: 'item', line })),
            orderLineId: String(saved.getSublistValue({ sublistId: 'item', fieldId: 'custcol_hc_order_line_id', line }) || ''),
            isClosed: saved.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line }) === true
          });
        }
        let closing = 0;
        lines.slice().reverse().forEach((line) => {
          const orderLineId = String(line.custcol_hc_order_line_id || '');
          const position = unpaired.findIndex((rmaLine) => rmaLine.item === String(line.item.id) && rmaLine.orderLineId === orderLineId);
          if (position < 0) {
            if (line.isClosed === true) missingLines.unshift({ item: String(line.item.id), custcol_hc_order_line_id: orderLineId });
            return;
          }
          const [rmaLine] = unpaired.splice(position, 1);
          if (line.isClosed === true && !rmaLine.isClosed) {
            saved.setSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: rmaLine.line, value: true });
            closing += 1;
          }
        });
        if (closing) {
          saved.save();
          closedLines = closing;
        }
      }

      return { id: rmaId, existing };
    } catch (e) {
      errorName = e.name;
      throw e;
    } finally {
      log.audit({
        title: `RMA [External ID: ${body.externalId || ''}]`,
        details: JSON.stringify({
          id: rmaId,
          existing,
          closedLines,
          missingFields: missingFields.length ? missingFields : undefined,
          missingLines: missingLines.length ? missingLines : undefined,
          error: errorName
        })
      });
    }
  }

  function valueFor(field, value) {
    if (value !== null && typeof value === 'object') return value.id;
    if (field && field.type === 'date') {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    return value;
  }

  return { get, post };
});
