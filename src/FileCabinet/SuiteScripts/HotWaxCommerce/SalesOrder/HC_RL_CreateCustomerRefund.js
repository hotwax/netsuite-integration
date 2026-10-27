/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/file', 'N/error'], (record, search, file, error) => {

  const DATE_TYPES = ['date', 'datetime', 'datetimetz'];

  function get() {
    return file.load({ id: './HC_RL_CreateCustomerRefund.openapi.json' }).getContents();
  }

  function post(request) {
    const depositLine = ((request.deposit || {}).items || [])[0] || {};
    const given = {
      'deposit.items[0].doc.id': (depositLine.doc || {}).id, 'deposit.items[0].amount': depositLine.amount,
      externalId: request.externalId, 'paymentMethod.id': (request.paymentMethod || {}).id, tranDate: request.tranDate
    };
    Object.entries(given).forEach(([name, value]) => {
      if (value == null || value === '') {
        throw error.create({ name: 'MISSING_FIELD', message: `${name} is required` });
      }
    });

    const existing = search.create({
      type: search.Type.CUSTOMER_REFUND,
      filters: [['externalid', 'is', request.externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    if (existing.length) {
      return { id: String(existing[0].getValue('internalid')), existing: true };
    }

    const depositId = parseInt(depositLine.doc.id, 10);
    const amount = money(depositLine.amount);
    const [year, month, day] = request.tranDate.split('-').map(Number);

    const customerRefund = record.transform({
      fromType: record.Type.CUSTOMER_DEPOSIT,
      fromId: depositId,
      toType: record.Type.CUSTOMER_REFUND,
      isDynamic: true
    });
    customerRefund.setValue({ fieldId: 'externalid', value: request.externalId });
    customerRefund.setValue({ fieldId: 'paymentmethod', value: parseInt(request.paymentMethod.id, 10) });
    customerRefund.setValue({ fieldId: 'trandate', value: new Date(year, month - 1, day) });
    if (request.memo) {
      customerRefund.setValue({ fieldId: 'memo', value: request.memo });
    }
    Object.keys(request).filter((fieldId) => /^cust/.test(fieldId)).forEach((fieldId) => {
      let value = request[fieldId];
      if (value && typeof value === 'object' && value.id != null) value = value.id;
      const field = customerRefund.getField({ fieldId });
      if (field && DATE_TYPES.includes(field.type) && typeof value === 'string') value = parseDate(value);
      customerRefund.setValue({ fieldId, value });
    });

    const line = customerRefund.findSublistLineWithValue({ sublistId: 'deposit', fieldId: 'doc', value: String(depositId) });
    if (line < 0) {
      throw error.create({ name: 'DEPOSIT_NOT_OPEN', message: `Deposit ${depositId} is not open for refund. Nothing was saved.` });
    }
    customerRefund.selectLine({ sublistId: 'deposit', line });
    const remaining = money(customerRefund.getCurrentSublistValue({ sublistId: 'deposit', fieldId: 'remaining' }));
    if (amount > remaining) {
      throw error.create({ name: 'AMOUNT_EXCEEDS_DUE', message: `${amount} was asked but deposit ${depositId} has ${remaining} open. Nothing was saved.` });
    }
    customerRefund.setCurrentSublistValue({ sublistId: 'deposit', fieldId: 'apply', value: true });
    customerRefund.setCurrentSublistValue({ sublistId: 'deposit', fieldId: 'amount', value: amount });
    customerRefund.commitLine({ sublistId: 'deposit' });

    return { id: String(customerRefund.save({ enableSourcing: true, ignoreMandatoryFields: false })), existing: false };
  }

  function money(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!match || match[7]) return new Date(value);
    const [year, month, day, hours, minutes, seconds] = match.slice(1, 7).map((part) => (part === undefined ? 0 : parseInt(part, 10)));
    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  return { get, post };
});
