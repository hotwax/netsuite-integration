/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/query', 'N/error', 'N/log'], (record, search, query, error, log) => {
  // One warehouse fulfillment: the order lines of one shipment the 3PL shipped, on one sales order, with the
  // tracking number. One line of a warehouse fulfillment batch (HC_MR_RunBatchFile), or one call.
  // Body: { externalId, salesOrderId, locationId, lines: [{ omsOrderLineId, quantity }], packages: [{ trackingNumber, carrier, weight }], tranDate }
  //   externalId     the fulfillment's external id, shared by every line of the shipment
  //   salesOrderId   NetSuite internal id of the sales order
  //   locationId     NetSuite internal id of the warehouse
  //   tranDate       optional, YYYY-MM-DD: the day the 3PL shipped, in the account's time zone. The fulfillment is dated
  //                  with it; without it NetSuite dates it with today.
  //   omsOrderLineId matches custcol_hc_order_line_id on the sales order line
  //   packages       optional; each is a package with its tracking number, the carrier's name (the package contents
  //                  description) and its weight, which NetSuite requires on a package. The ship method and address
  //                  come from the sales order.
  // Answers { id, existing }, as HC_RL_CreateItemFulfillment does: existing is true when a fulfillment with this
  // external id is already there, or when every line asked for is already fulfilled on the order (the 3PL
  // integration's work, or a person's). A line with less committed stock than asked is refused before anything is
  // made: NO_STOCK.
  const LINE_ID = 'custcol_hc_order_line_id';

  function post(body) {
    if (!body.externalId || !body.salesOrderId || !body.locationId || !body.lines || !body.lines.length) {
      throw error.create({ name: 'MISSING_FIELD', message: 'externalId, salesOrderId, locationId and lines are required' });
    }
    if (body.tranDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.tranDate)) {
      throw error.create({ name: 'INVALID_FIELD', message: 'tranDate must be YYYY-MM-DD, got ' + body.tranDate });
    }
    const existingId = fulfillmentByExternalId(body.externalId);
    if (existingId) return { id: existingId, existing: true };

    const wanted = {};
    body.lines.forEach((line) => { wanted[String(line.omsOrderLineId)] = Number(line.quantity); });

    // The sales order's own lines say what is fulfilled and what is committed, by OMS line id.
    const orderLines = salesOrderLines(body.salesOrderId);
    const unknown = Object.keys(wanted).filter((id) => !orderLines[id]);
    if (unknown.length) {
      throw error.create({ name: 'LINE_NOT_OPEN', message: 'Order lines not on sales order ' + body.salesOrderId + ': ' + unknown.join(', ') });
    }
    const shippedIds = Object.keys(wanted).filter((id) => orderLines[id].fulfilled >= wanted[id]);
    const open = Object.keys(wanted).filter((id) => shippedIds.indexOf(id) < 0);
    if (!open.length) {
      const shipped = fulfillmentsThatShipped(body.salesOrderId, shippedIds);
      const shippedId = shipped[shippedIds[0]];
      if (!shippedId) {
        throw error.create({ name: 'FULFILLMENT_NOT_FOUND', message: 'Sales order ' + body.salesOrderId + ' shows lines ' + shippedIds.join(', ') + ' fulfilled but no item fulfillment carries them' });
      }
      return { id: shippedId, existing: true };
    }
    const short = open.filter((id) => orderLines[id].committed < wanted[id])
      .map((id) => 'line ' + id + ': ' + orderLines[id].committed + ' committed of ' + wanted[id]);
    if (short.length) {
      throw error.create({ name: 'NO_STOCK', message: 'No stock at location ' + body.locationId + ' for sales order ' + body.salesOrderId + ': ' + short.join('; ') });
    }

    let fulfillment;
    try {
      fulfillment = record.transform({
        fromType: record.Type.SALES_ORDER, fromId: body.salesOrderId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: false
      });
    } catch (e) {
      if (e.name === 'INVALID_INITIALIZE_REF') {
        throw error.create({ name: 'ORDER_CLOSED', message: 'Sales order ' + body.salesOrderId + ' is closed or has nothing left to fulfill; lines not shipped: ' + open.join(', ') });
      }
      throw e;
    }
    fulfillment.setValue({ fieldId: 'externalid', value: body.externalId });
    fulfillment.setValue({ fieldId: 'shipstatus', value: 'C' });
    fulfillment.setValue({ fieldId: 'memo', value: 'Warehouse fulfillment by HotWax OMS' });
    if (body.tranDate) {
      const [y, m, d] = body.tranDate.split('-').map(Number);
      fulfillment.setValue({ fieldId: 'trandate', value: new Date(y, m - 1, d, 12) });
    }

    const matched = {};
    const lineCount = fulfillment.getLineCount({ sublistId: 'item' });
    for (let i = 0; i < lineCount; i++) {
      const omsLineId = String(fulfillment.getSublistValue({ sublistId: 'item', fieldId: LINE_ID, line: i }) || '');
      if (!omsLineId) continue;
      if (open.indexOf(omsLineId) < 0) {
        fulfillment.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: false });
        continue;
      }
      matched[omsLineId] = true;
      fulfillment.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: true });
      fulfillment.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i, value: wanted[omsLineId] });
      fulfillment.setSublistValue({ sublistId: 'item', fieldId: 'location', line: i, value: body.locationId });
    }
    const missing = open.filter((id) => !matched[id]);
    if (missing.length) {
      throw error.create({ name: 'LINE_NOT_OPEN', message: 'Order lines not open on the fulfillment of sales order ' + body.salesOrderId + ': ' + missing.join(', ') });
    }

    log.debug({ title: 'ItemFulfillment [External ID: ' + body.externalId + '] - Packages before ours', details: fulfillment.getLineCount({ sublistId: 'package' }) });
    (body.packages || []).forEach((pack, i) => {
      fulfillment.setSublistValue({ sublistId: 'package', fieldId: 'packagetrackingnumber', line: i, value: pack.trackingNumber });
      if (pack.carrier) fulfillment.setSublistValue({ sublistId: 'package', fieldId: 'packagedescr', line: i, value: pack.carrier });
      if (pack.weight) fulfillment.setSublistValue({ sublistId: 'package', fieldId: 'packageweight', line: i, value: Number(pack.weight) });
    });

    try {
      const id = String(fulfillment.save({ enableSourcing: true }));
      if ((body.packages || []).length) removeDefaultPackages(id, body.externalId);
      return { id: id, existing: false };
    } catch (e) {
      log.error({ title: 'ItemFulfillment [External ID: ' + body.externalId + ', Sales Order: ' + body.salesOrderId + '] - Not saved', details: e.message });
      throw e;
    }
  }

  // TODO: revisit. Found by watching Dolls Kill UAT, not from NetSuite's documentation: NetSuite adds its own package
  // on save, weighed from the items (0.01 when they have none), and a re-save with it removed keeps ours alone. Ours
  // carry a tracking number, so a package without one goes. A second save per fulfillment is not the best design.
  function removeDefaultPackages(id, externalId) {
    const saved = record.load({ type: record.Type.ITEM_FULFILLMENT, id: id, isDynamic: false });
    const before = saved.getLineCount({ sublistId: 'package' });
    let removed = 0;
    for (let i = before - 1; i >= 0; i--) {
      if (!saved.getSublistValue({ sublistId: 'package', fieldId: 'packagetrackingnumber', line: i })) {
        saved.removeLine({ sublistId: 'package', line: i });
        removed++;
      }
    }
    log.debug({ title: 'ItemFulfillment [External ID: ' + externalId + ', ID: ' + id + '] - Packages after save', details: before + ' found, ' + removed + ' removed' });
    if (removed) saved.save({ enableSourcing: true });
  }

  function fulfillmentByExternalId(externalId) {
    const found = search.create({
      type: search.Type.ITEM_FULFILLMENT,
      filters: [['externalid', 'is', externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    return found.length ? String(found[0].getValue('internalid')) : null;
  }

  // The sales order's lines by OMS line id: quantity, committed, fulfilled.
  function salesOrderLines(salesOrderId) {
    const salesOrder = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId, isDynamic: false });
    const lines = {};
    const count = salesOrder.getLineCount({ sublistId: 'item' });
    for (let i = 0; i < count; i++) {
      const omsLineId = String(salesOrder.getSublistValue({ sublistId: 'item', fieldId: LINE_ID, line: i }) || '');
      if (!omsLineId) continue;
      // An item discount line carries its item's OMS line id but no quantity; it must not replace the item line.
      if (!Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }) || 0)) continue;
      lines[omsLineId] = {
        quantity: Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }) || 0),
        committed: Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line: i }) || 0),
        fulfilled: Number(salesOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i }) || 0)
      };
    }
    return lines;
  }

  // OMS line id to the fulfillment made from this sales order that carries it. On a fulfillment the first
  // item line's column values sit on the main line (line 0), so no mainline filter here.
  function fulfillmentsThatShipped(salesOrderId, omsLineIds) {
    const marks = omsLineIds.map(() => '?').join(', ');
    const rows = query.runSuiteQL({
      query: 'select tl.custcol_hc_order_line_id as omsline, tl.transaction as fulfillment from transactionline tl'
        + ' join transaction t on t.id = tl.transaction where t.type = \'ItemShip\''
        + ' and tl.createdfrom = ? and tl.custcol_hc_order_line_id in (' + marks + ')',
      params: [Number(salesOrderId)].concat(omsLineIds)
    }).asMappedResults();
    const shipped = {};
    rows.forEach((row) => { shipped[String(row.omsline)] = String(row.fulfillment); });
    return shipped;
  }

  return { post: post };
});
