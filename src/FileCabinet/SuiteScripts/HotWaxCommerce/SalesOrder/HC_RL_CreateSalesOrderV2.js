/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/error', 'N/log'], (record, search, error, log) => {
  // Body: the salesOrder REST record body; externalId required. Answer: { id, existing }.
  // Saves in dynamic mode so the legacy tax engine computes tax from taxcode and taxrate1.
  const NOT_FIELDS = ['item', 'shippingaddress', 'billingaddress', 'links'];
  // Set first, in this order: the form resets the defaults, the customer gives the subsidiary, the subsidiary bounds the location and the department.
  const LEAD_FIELDS = ['customform', 'entity', 'subsidiary', 'location', 'department'];
  const DATE_TYPES = ['date', 'datetime', 'datetimetz'];

  function post(body) {
    if (!body.externalId) {
      throw error.create({ name: 'MISSING_FIELD', message: 'externalId is required' });
    }
    const existing = search.create({
      type: search.Type.SALES_ORDER,
      filters: [['externalid', 'is', body.externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    if (existing.length) {
      return { id: String(existing[0].getValue('internalid')), existing: true };
    }

    const salesOrder = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
    const fields = {};
    Object.keys(body).forEach((key) => { fields[key.toLowerCase()] = body[key]; });
    LEAD_FIELDS.forEach((fieldId) => setField(salesOrder, fieldId, fields[fieldId]));
    Object.keys(fields).forEach((fieldId) => {
      if (LEAD_FIELDS.includes(fieldId) || NOT_FIELDS.includes(fieldId)) return;
      setField(salesOrder, fieldId, fields[fieldId]);
    });
    setAddress(salesOrder, 'shippingaddress', body.shippingAddress);
    setAddress(salesOrder, 'billingaddress', body.billingAddress);
    ((body.item && body.item.items) || []).forEach((line) => setLine(salesOrder, line));

    try {
      return { id: String(salesOrder.save()), existing: false };
    } catch (e) {
      log.error({ title: 'SalesOrder [External ID: ' + body.externalId + '] - Not saved', details: e.message });
      throw e;
    }
  }

  function setField(rec, fieldId, value) {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      if (value.id === undefined || value.id === null) {
        if (value.refName !== undefined) rec.setText({ fieldId, text: value.refName });
        return;
      }
      value = value.id;
    }
    const field = rec.getField({ fieldId });
    if (field && DATE_TYPES.includes(field.type) && typeof value === 'string') value = parseDate(value);
    rec.setValue({ fieldId, value });
  }

  function setLineField(rec, fieldId, value) {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      if (value.id === undefined || value.id === null) {
        if (value.refName !== undefined) rec.setCurrentSublistText({ sublistId: 'item', fieldId, text: value.refName });
        return;
      }
      value = value.id;
    }
    const field = rec.getCurrentSublistField({ sublistId: 'item', fieldId });
    if (field && DATE_TYPES.includes(field.type) && typeof value === 'string') value = parseDate(value);
    rec.setCurrentSublistValue({ sublistId: 'item', fieldId, value });
  }

  // item, price, the rest, taxcode, taxrate1: each re-sources the ones after it
  function setLine(rec, line) {
    rec.selectNewLine({ sublistId: 'item' });
    const fields = {};
    Object.keys(line).forEach((key) => { fields[key.toLowerCase()] = line[key]; });
    setLineField(rec, 'item', fields.item);
    setLineField(rec, 'price', fields.price);
    Object.keys(fields).forEach((fieldId) => {
      if (['item', 'price', 'taxcode', 'taxrate1', 'links'].includes(fieldId)) return;
      setLineField(rec, fieldId, fields[fieldId]);
    });
    setLineField(rec, 'taxcode', fields.taxcode);
    setLineField(rec, 'taxrate1', fields.taxrate1);
    rec.commitLine({ sublistId: 'item' });
  }

  // country first: it re-derives the address form
  function setAddress(rec, fieldId, address) {
    if (!address) return;
    const subrecord = rec.getSubrecord({ fieldId });
    const fields = {};
    Object.keys(address).forEach((key) => { fields[key.toLowerCase()] = address[key]; });
    setField(subrecord, 'country', fields.country);
    Object.keys(fields).forEach((key) => {
      if (key === 'country' || key === 'links' || fields[key] === '') return;
      setField(subrecord, key, fields[key]);
    });
  }

  // a time with a zone is an instant; a day or a zone-less time is the account's local wall-clock
  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!match) return new Date(value);
    if (match[7]) return new Date(value);
    const [year, month, day, hours, minutes, seconds] = match.slice(1, 7).map((part) => (part === undefined ? 0 : parseInt(part, 10)));
    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  return { post };
});
