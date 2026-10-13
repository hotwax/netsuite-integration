/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/error'], (record, search, error) => {

  const CUSTOM_PRICE_LEVEL = -1;

  const HEADER_VALUES = {
    tranId: 'tranid', externalId: 'externalid', createdDate: 'createddate', memo: 'memo',
    subtotal: 'subtotal', taxTotal: 'taxtotal', total: 'total', applied: 'applied', unapplied: 'unapplied',
    amountRemaining: 'amountremaining', custbody_ava_disable_tax_calculation: 'custbody_ava_disable_tax_calculation'
  };
  const HEADER_REFERENCES = {
    status: 'status', createdFrom: 'createdfrom', entity: 'entity', subsidiary: 'subsidiary', currency: 'currency',
    location: 'location', department: 'department', custbody4: 'custbody4', postingPeriod: 'postingperiod',
    custbody_avalara_status: 'custbody_avalara_status'
  };
  const LINE_VALUES = {
    line: 'line', lineUniqueKey: 'lineuniquekey', orderLine: 'orderline', description: 'description',
    quantity: 'quantity', rate: 'rate', amount: 'amount'
  };
  const LINE_REFERENCES = { orderDoc: 'orderdoc', item: 'item', taxCode: 'taxcode', location: 'location', department: 'department' };

  function post(request) {
    ['rmaId', 'externalId', 'tranDate', 'locationId'].forEach((name) => {
      if (request[name] == null || request[name] === '') {
        throw error.create({ name: 'MISSING_FIELD', message: `${name} is required` });
      }
    });
    if (request.balanceTo) {
      ['total', 'taxVarianceItemId', 'taxCodeId'].forEach((name) => {
        if (request.balanceTo[name] == null || request.balanceTo[name] === '') {
          throw error.create({ name: 'MISSING_FIELD', message: `balanceTo.${name} is required` });
        }
      });
    }
    const adjustments = request.adjustments || [];
    adjustments.forEach((adjustment, index) => {
      ['itemId', 'rate', 'taxCodeId'].forEach((name) => {
        if (adjustment[name] == null || adjustment[name] === '') {
          throw error.create({ name: 'MISSING_FIELD', message: `adjustments[${index}].${name} is required` });
        }
      });
    });
    const overrideItems = request.overrideItems || [];
    overrideItems.forEach((item, index) => {
      ['itemId', 'rate', 'taxCodeId'].forEach((name) => {
        if (item[name] == null || item[name] === '') {
          throw error.create({ name: 'MISSING_FIELD', message: `overrideItems[${index}].${name} is required` });
        }
      });
    });
    if (request.closeLines != null && !Array.isArray(request.closeLines)) {
      throw error.create({ name: 'INVALID_FIELD', message: 'closeLines must be an array' });
    }
    const closeLineIds = [...new Set((request.closeLines || []).map(String))];

    const headerCustomFields = request.customFields || {};
    const lineCustomFields = (request.balanceTo && request.balanceTo.customFields) || {};
    const locationId = parseInt(request.locationId, 10);
    const departmentId = request.departmentId ? parseInt(request.departmentId, 10) : null;

    const existingCreditMemos = search.create({
      type: search.Type.CREDIT_MEMO,
      filters: [['externalid', 'is', request.externalId], 'AND', ['mainline', 'is', 'T']],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });
    if (existingCreditMemos.length) {
      const existingCreditMemoId = existingCreditMemos[0].getValue('internalid');
      const balance = request.balanceTo ? ensureCreditMemoCoversSettlement(existingCreditMemoId, request.balanceTo, locationId, departmentId, lineCustomFields) : null;
      return { ...readCreditMemo(existingCreditMemoId, true, balance, Object.keys(headerCustomFields), Object.keys(lineCustomFields)), closedLines: [] };
    }

    const closedLines = closeRmaLines(request.rmaId, closeLineIds);
    const [year, month, day] = request.tranDate.split('-').map(Number);

    const creditMemo = record.transform({
      fromType: record.Type.RETURN_AUTHORIZATION,
      fromId: parseInt(request.rmaId, 10),
      toType: record.Type.CREDIT_MEMO,
      isDynamic: true
    });

    creditMemo.setValue({ fieldId: 'externalid', value: request.externalId });
    creditMemo.setValue({ fieldId: 'trandate', value: new Date(year, month - 1, day) });
    creditMemo.setValue({ fieldId: 'location', value: locationId });
    creditMemo.setValue({ fieldId: 'custbody_ava_disable_tax_calculation', value: request.disableTaxCalculation !== false });
    if (departmentId) {
      creditMemo.setValue({ fieldId: 'department', value: departmentId });
      creditMemo.setValue({ fieldId: 'custbody4', value: departmentId });
    }
    if (request.memo) {
      creditMemo.setValue({ fieldId: 'memo', value: request.memo });
    }
    Object.entries(headerCustomFields).forEach(([fieldId, value]) => {
      creditMemo.setValue({ fieldId, value });
    });

    const copiedLineCount = creditMemo.getLineCount({ sublistId: 'item' });
    if (overrideItems.length) {
      // The RMA retains physical lines for receiving. A completed warranty memo uses its
      // resolved financial lines instead, so tax is calculated on the Credit Memo itself.
      for (let line = copiedLineCount - 1; line >= 0; line--) {
        creditMemo.removeLine({ sublistId: 'item', line, ignoreRecalc: true });
      }
      overrideItems.forEach((item) => addCustomItem(creditMemo, item, request.locationId, request.departmentId));
    } else {
      for (let line = 0; line < copiedLineCount; line++) {
        creditMemo.selectLine({ sublistId: 'item', line });
        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId, ignoreFieldChange: true });
        creditMemo.commitLine({ sublistId: 'item' });
      }
    }

    // Settlement instruments such as gift cards reduce the Credit Memo after the returned
    // merchandise. They must not be copied through the RMA.
    adjustments.forEach((adjustment) => addCustomItem(creditMemo, adjustment, request.locationId, request.departmentId));

    const creditMemoId = creditMemo.save({ enableSourcing: true, ignoreMandatoryFields: false });
    const balance = request.balanceTo ? ensureCreditMemoCoversSettlement(creditMemoId, request.balanceTo, locationId, departmentId, lineCustomFields) : null;
    return { ...readCreditMemo(creditMemoId, false, balance, Object.keys(headerCustomFields), Object.keys(lineCustomFields)), closedLines };
  }

  function closeRmaLines(rmaId, lineIds) {
    if (!lineIds.length) return [];
    const rma = record.load({ type: record.Type.RETURN_AUTHORIZATION, id: parseInt(rmaId, 10), isDynamic: true });
    const indexByLineId = {};
    for (let line = 0; line < rma.getLineCount({ sublistId: 'item' }); line++) {
      indexByLineId[String(rma.getSublistValue({ sublistId: 'item', fieldId: 'line', line }))] = line;
    }
    const unknownLineIds = lineIds.filter((lineId) => !(lineId in indexByLineId));
    if (unknownLineIds.length) {
      throw error.create({ name: 'UNKNOWN_LINE', message: `RMA ${rmaId} has no line ${unknownLineIds.join(', ')}` });
    }
    const openLineIds = lineIds.filter((lineId) => rma.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: indexByLineId[lineId] }) !== true);
    openLineIds.forEach((lineId) => {
      rma.selectLine({ sublistId: 'item', line: indexByLineId[lineId] });
      rma.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: true });
      rma.commitLine({ sublistId: 'item' });
    });
    if (openLineIds.length) rma.save();
    return openLineIds;
  }

  function addCustomItem(creditMemo, item, defaultLocationId, defaultDepartmentId) {
    creditMemo.selectNewLine({ sublistId: 'item' });
    creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: parseInt(item.itemId, 10) });
    creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(item.quantity || 1) });
    creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: CUSTOM_PRICE_LEVEL });
    creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: Number(item.rate) });
    creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: parseInt(item.taxCodeId, 10), ignoreFieldChange: true });
    creditMemo.setCurrentSublistValue({
      sublistId: 'item', fieldId: 'location',
      value: parseInt(item.locationId || defaultLocationId, 10), ignoreFieldChange: true
    });
    const departmentId = item.departmentId || defaultDepartmentId;
    if (departmentId) {
      creditMemo.setCurrentSublistValue({
        sublistId: 'item', fieldId: 'department', value: parseInt(departmentId, 10), ignoreFieldChange: true
      });
    }
    if (item.description) {
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: item.description });
    }
    Object.entries(item.customFields || {}).forEach(([fieldId, value]) => {
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId, value });
    });
    // Do not set taxrate1: AvaTax calculates the Credit Memo tax from the line tax code and amount.
    creditMemo.commitLine({ sublistId: 'item' });
  }

  function ensureCreditMemoCoversSettlement(creditMemoId, balanceTo, locationId, departmentId, lineCustomFields) {
    const creditMemo = record.load({ type: record.Type.CREDIT_MEMO, id: creditMemoId, isDynamic: true });
    const totalBefore = roundCurrency(creditMemo.getValue({ fieldId: 'total' }));
    const requiredTotal = roundCurrency(balanceTo.total);
    const balanceAmount = roundCurrency(requiredTotal - totalBefore);

    if (balanceAmount > 0) {
      creditMemo.selectNewLine({ sublistId: 'item' });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: parseInt(balanceTo.taxVarianceItemId, 10) });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'price', value: CUSTOM_PRICE_LEVEL });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: balanceAmount });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: parseInt(balanceTo.taxCodeId, 10), ignoreFieldChange: true });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxrate1', value: 0, ignoreFieldChange: true });
      creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId, ignoreFieldChange: true });
      if (departmentId) {
        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: departmentId, ignoreFieldChange: true });
      }
      if (balanceTo.description) {
        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: balanceTo.description });
      }
      Object.entries(lineCustomFields).forEach(([fieldId, value]) => {
        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId, value });
      });
      creditMemo.commitLine({ sublistId: 'item' });
      creditMemo.save({ enableSourcing: true, ignoreMandatoryFields: false });
    }

    return { total: requiredTotal, totalBefore, totalDifference: balanceAmount > 0 ? balanceAmount : 0 };
  }

  function roundCurrency(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function readCreditMemo(creditMemoId, existing, balance, headerCustomFieldNames, lineCustomFieldNames) {
    const creditMemo = record.load({ type: record.Type.CREDIT_MEMO, id: creditMemoId, isDynamic: false });
    const result = { existing, balance, id: String(creditMemoId) };
    Object.entries(HEADER_VALUES).forEach(([name, fieldId]) => {
      result[name] = creditMemo.getValue({ fieldId });
    });
    Object.entries(HEADER_REFERENCES).forEach(([name, fieldId]) => {
      result[name] = reference(creditMemo.getValue({ fieldId }), creditMemo.getText({ fieldId }));
    });
    const tranDate = creditMemo.getValue({ fieldId: 'trandate' });
    result.tranDate = [tranDate.getFullYear(), String(tranDate.getMonth() + 1).padStart(2, '0'), String(tranDate.getDate()).padStart(2, '0')].join('-');
    result.customFields = {};
    headerCustomFieldNames.forEach((fieldId) => {
      result.customFields[fieldId] = creditMemo.getValue({ fieldId });
    });

    const items = [];
    const lineCount = creditMemo.getLineCount({ sublistId: 'item' });
    for (let line = 0; line < lineCount; line++) {
      const value = (fieldId) => creditMemo.getSublistValue({ sublistId: 'item', fieldId, line });
      const text = (fieldId) => creditMemo.getSublistText({ sublistId: 'item', fieldId, line });
      const row = {};
      Object.entries(LINE_VALUES).forEach(([name, fieldId]) => { row[name] = value(fieldId); });
      Object.entries(LINE_REFERENCES).forEach(([name, fieldId]) => { row[name] = reference(value(fieldId), text(fieldId)); });
      row.line = Number(row.line);
      row.orderLine = row.orderLine ? Number(row.orderLine) : null;
      row.customFields = {};
      lineCustomFieldNames.forEach((fieldId) => { row.customFields[fieldId] = value(fieldId); });
      items.push(row);
    }
    result.item = { items };
    return result;
  }

  function reference(id, name) {
    return id ? { id: String(id), refName: name } : null;
  }

  return { post };
});
