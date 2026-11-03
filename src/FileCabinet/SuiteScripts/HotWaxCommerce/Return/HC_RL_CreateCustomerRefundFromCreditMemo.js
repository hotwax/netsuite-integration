/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/error'], (record, search, error) => {

  const HEADER_VALUES = { tranId: 'tranid', externalId: 'externalid', memo: 'memo' };
  const HEADER_MONEY = { total: 'total' };
  const HEADER_REFERENCES = {
    postingPeriod: 'postingperiod', customer: 'customer', paymentMethod: 'paymentmethod', account: 'account',
    arAcct: 'aracct', location: 'location', department: 'department', currency: 'currency'
  };
  const APPLY_VALUES = { doc: 'doc', refNum: 'refnum', type: 'type', apply: 'apply' };
  const APPLY_MONEY = { amount: 'amount', due: 'due', total: 'total' };
  const CREDIT_MEMO_VALUES = { tranId: 'tranid' };
  const CREDIT_MEMO_MONEY = { total: 'total', applied: 'applied', unapplied: 'unapplied' };

  function post(request) {
    ['creditMemoId', 'externalId', 'paymentMethodId', 'amount', 'tranDate', 'locationId', 'departmentId'].forEach((name) => {
      if (request[name] == null || request[name] === '') {
        throw error.create({ name: 'MISSING_FIELD', message: `${name} is required` });
      }
    });

    const creditMemoId = parseInt(request.creditMemoId, 10);
    const customFields = request.customFields || {};

    const existingRefunds = search.create({
      type: search.Type.CUSTOMER_REFUND,
      filters: [['externalid', 'is', request.externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    if (existingRefunds.length) {
      return readCustomerRefund(existingRefunds[0].getValue('internalid'), creditMemoId, true, Object.keys(customFields));
    }

    const amount = money(request.amount);
    const [year, month, day] = request.tranDate.split('-').map(Number);

    const customerRefund = record.transform({
      fromType: record.Type.CREDIT_MEMO,
      fromId: creditMemoId,
      toType: record.Type.CUSTOMER_REFUND,
      isDynamic: true
    });
    customerRefund.setValue({ fieldId: 'externalid', value: request.externalId });
    customerRefund.setValue({ fieldId: 'paymentmethod', value: parseInt(request.paymentMethodId, 10) });
    customerRefund.setValue({ fieldId: 'trandate', value: new Date(year, month - 1, day) });
    customerRefund.setValue({ fieldId: 'location', value: parseInt(request.locationId, 10) });
    customerRefund.setValue({ fieldId: 'department', value: parseInt(request.departmentId, 10) });
    if (request.memo) {
      customerRefund.setValue({ fieldId: 'memo', value: request.memo });
    }
    Object.entries(customFields).forEach(([fieldId, value]) => {
      customerRefund.setValue({ fieldId, value });
    });

    const creditMemoLine = customerRefund.findSublistLineWithValue({ sublistId: 'apply', fieldId: 'doc', value: String(creditMemoId) });
    if (creditMemoLine < 0) {
      throw error.create({ name: 'CREDIT_MEMO_NOT_OPEN', message: `Credit memo ${creditMemoId} is not open for a refund. Nothing was saved.` });
    }
    customerRefund.selectLine({ sublistId: 'apply', line: creditMemoLine });
    const due = money(customerRefund.getCurrentSublistValue({ sublistId: 'apply', fieldId: 'due' }));
    if (amount > due) {
      throw error.create({ name: 'AMOUNT_EXCEEDS_DUE', message: `${amount} was asked but credit memo ${creditMemoId} has ${due} open. Nothing was saved.` });
    }
    customerRefund.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
    customerRefund.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: amount });
    customerRefund.commitLine({ sublistId: 'apply' });

    const customerRefundId = customerRefund.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return readCustomerRefund(customerRefundId, creditMemoId, false, Object.keys(customFields));
  }

  function readCustomerRefund(customerRefundId, creditMemoId, existing, customFieldNames) {
    const customerRefund = record.load({ type: record.Type.CUSTOMER_REFUND, id: customerRefundId, isDynamic: false });
    const result = { existing, id: String(customerRefundId) };
    Object.entries(HEADER_VALUES).forEach(([name, fieldId]) => {
      result[name] = customerRefund.getValue({ fieldId });
    });
    Object.entries(HEADER_MONEY).forEach(([name, fieldId]) => {
      result[name] = money(customerRefund.getValue({ fieldId }));
    });
    Object.entries(HEADER_REFERENCES).forEach(([name, fieldId]) => {
      result[name] = reference(customerRefund.getValue({ fieldId }), customerRefund.getText({ fieldId }));
    });
    const tranDate = customerRefund.getValue({ fieldId: 'trandate' });
    result.tranDate = [tranDate.getFullYear(), String(tranDate.getMonth() + 1).padStart(2, '0'), String(tranDate.getDate()).padStart(2, '0')].join('-');
    result.customFields = {};
    customFieldNames.forEach((fieldId) => {
      result.customFields[fieldId] = customerRefund.getValue({ fieldId });
    });

    const items = [];
    const lineCount = customerRefund.getLineCount({ sublistId: 'apply' });
    for (let line = 0; line < lineCount; line++) {
      const value = (fieldId) => customerRefund.getSublistValue({ sublistId: 'apply', fieldId, line });
      const row = {};
      Object.entries(APPLY_VALUES).forEach(([name, fieldId]) => { row[name] = value(fieldId); });
      Object.entries(APPLY_MONEY).forEach(([name, fieldId]) => { row[name] = money(value(fieldId)); });
      row.doc = String(row.doc);
      row.apply = row.apply === true || row.apply === 'T';
      items.push(row);
    }
    result.apply = { items };

    const creditMemo = record.load({ type: record.Type.CREDIT_MEMO, id: creditMemoId, isDynamic: false });
    result.creditMemo = { id: String(creditMemoId), status: reference(creditMemo.getValue({ fieldId: 'status' }), creditMemo.getText({ fieldId: 'status' })) };
    Object.entries(CREDIT_MEMO_VALUES).forEach(([name, fieldId]) => {
      result.creditMemo[name] = creditMemo.getValue({ fieldId });
    });
    Object.entries(CREDIT_MEMO_MONEY).forEach(([name, fieldId]) => {
      result.creditMemo[name] = money(creditMemo.getValue({ fieldId }));
    });
    return result;
  }

  function money(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function reference(id, name) {
    return id ? { id: String(id), refName: name } : null;
  }

  return { post };
});
