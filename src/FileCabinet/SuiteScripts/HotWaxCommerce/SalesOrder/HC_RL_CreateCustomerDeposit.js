/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/file', 'N/error'], (record, search, file, error) => {

  const HEADER_VALUES = { tranId: 'tranid', externalId: 'externalid', memo: 'memo' };
  const HEADER_MONEY = { payment: 'payment', total: 'total' };
  const HEADER_REFERENCES = {
    postingPeriod: 'postingperiod', customer: 'customer', salesOrder: 'salesorder', paymentMethod: 'paymentmethod', account: 'account',
    location: 'location', department: 'department', currency: 'currency', status: 'status'
  };
  const BODY_REFERENCES = { department: 'department', location: 'location', account: 'account' };
  const CUSTOM_FIELD = /^(cust(body|col|entity|item|record|event)|cseg)/;
  const DATE_TYPES = ['date', 'datetime', 'datetimetz'];

  function get() {
    return file.load({ id: './HC_RL_CreateCustomerDeposit.openapi.json' }).getContents();
  }

  function post(request) {
    const given = {
      externalId: request.externalId, 'salesOrder.id': (request.salesOrder || {}).id, payment: request.payment,
      'paymentMethod.id': (request.paymentMethod || {}).id, tranDate: request.tranDate
    };
    Object.entries(given).forEach(([name, value]) => {
      if (value == null || value === '') {
        throw error.create({ name: 'MISSING_FIELD', message: `${name} is required` });
      }
    });

    const customFields = {};
    Object.keys(request).filter((name) => CUSTOM_FIELD.test(name)).forEach((name) => { customFields[name] = request[name]; });

    const existingDeposits = search.create({
      type: search.Type.CUSTOMER_DEPOSIT,
      filters: [['externalid', 'is', request.externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    if (existingDeposits.length) {
      return readCustomerDeposit(existingDeposits[0].getValue('internalid'), true, Object.keys(customFields));
    }

    const [year, month, day] = request.tranDate.split('-').map(Number);

    const customerDeposit = record.create({
      type: record.Type.CUSTOMER_DEPOSIT,
      isDynamic: false,
      defaultValues: { salesorder: parseInt(request.salesOrder.id, 10) }
    });
    if ((request.customForm || {}).id) {
      customerDeposit.setValue({ fieldId: 'customform', value: parseInt(request.customForm.id, 10) });
    }
    if ((request.customer || {}).id) {
      customerDeposit.setValue({ fieldId: 'customer', value: parseInt(request.customer.id, 10) });
    }
    customerDeposit.setValue({ fieldId: 'externalid', value: request.externalId });
    customerDeposit.setValue({ fieldId: 'payment', value: money(request.payment) });
    customerDeposit.setValue({ fieldId: 'paymentmethod', value: parseInt(request.paymentMethod.id, 10) });
    customerDeposit.setValue({ fieldId: 'trandate', value: new Date(year, month - 1, day) });
    if (request.memo) {
      customerDeposit.setValue({ fieldId: 'memo', value: request.memo });
    }
    Object.entries(BODY_REFERENCES).forEach(([name, fieldId]) => {
      if ((request[name] || {}).id) {
        customerDeposit.setValue({ fieldId, value: parseInt(request[name].id, 10) });
      }
    });
    Object.entries(customFields).forEach(([fieldId, value]) => {
      if (value && typeof value === 'object' && value.id != null) value = value.id;
      const field = customerDeposit.getField({ fieldId });
      if (field && DATE_TYPES.includes(field.type) && typeof value === 'string') value = parseDate(value);
      customerDeposit.setValue({ fieldId, value });
    });

    const customerDepositId = customerDeposit.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return readCustomerDeposit(customerDepositId, false, Object.keys(customFields));
  }

  function readCustomerDeposit(customerDepositId, existing, customFieldNames) {
    const customerDeposit = record.load({ type: record.Type.CUSTOMER_DEPOSIT, id: customerDepositId, isDynamic: false });
    const result = { existing, id: String(customerDepositId) };
    Object.entries(HEADER_VALUES).forEach(([name, fieldId]) => {
      result[name] = customerDeposit.getValue({ fieldId });
    });
    Object.entries(HEADER_MONEY).forEach(([name, fieldId]) => {
      result[name] = money(customerDeposit.getValue({ fieldId }));
    });
    Object.entries(HEADER_REFERENCES).forEach(([name, fieldId]) => {
      result[name] = reference(customerDeposit.getValue({ fieldId }), customerDeposit.getText({ fieldId }));
    });
    const tranDate = customerDeposit.getValue({ fieldId: 'trandate' });
    result.tranDate = [tranDate.getFullYear(), String(tranDate.getMonth() + 1).padStart(2, '0'), String(tranDate.getDate()).padStart(2, '0')].join('-');
    result.customFields = {};
    customFieldNames.forEach((fieldId) => {
      result.customFields[fieldId] = customerDeposit.getValue({ fieldId });
    });
    return result;
  }

  function money(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function reference(id, name) {
    return id ? { id: String(id), refName: name } : null;
  }

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!match) return new Date(value);
    if (match[7]) return new Date(value);
    const [year, month, day, hours, minutes, seconds] = match.slice(1, 7).map((part) => (part === undefined ? 0 : parseInt(part, 10)));
    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  return { get, post };
});
