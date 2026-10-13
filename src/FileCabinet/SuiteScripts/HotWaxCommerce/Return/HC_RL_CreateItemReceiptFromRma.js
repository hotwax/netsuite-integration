/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/query', 'N/file', 'N/error', 'N/log'], (record, search, query, file, error, log) => {

  function get() {
    return file.load({ id: './HC_RL_CreateItemReceiptFromRma.openapi.json' }).getContents();
  }

  function post(body) {
    const { rmaId, item, ...header } = body;
    const lines = (item && item.items) || [];
    const missingFields = ['rmaId', 'externalId'].filter((name) => !body[name]).concat(lines.length ? [] : ['item.items']);
    const missingLines = [];
    let receiptId = null;
    let existing = false;
    let errorName;

    try {
      if (missingFields.length) {
        throw error.create({ name: 'MISSING_FIELD', message: 'rmaId, externalId and item.items are required' });
      }

      const found = search.create({
        type: search.Type.ITEM_RECEIPT,
        filters: [['externalid', 'is', body.externalId], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid']
      }).run().getRange({ start: 0, end: 1 });
      existing = found.length > 0;

      if (existing) {
        receiptId = String(found[0].getValue('internalid'));
      } else {
        const rma = record.load({ type: record.Type.RETURN_AUTHORIZATION, id: rmaId, isDynamic: false });
        const rmaLineIds = {};
        for (let line = 0; line < rma.getLineCount({ sublistId: 'item' }); line++) {
          const omsLineId = String(rma.getSublistValue({ sublistId: 'item', fieldId: 'custcol_hc_order_line_id', line }) || '');
          if (omsLineId) rmaLineIds[omsLineId] = String(rma.getSublistValue({ sublistId: 'item', fieldId: 'line', line }));
        }
        const kitMembers = lines.some((bodyLine) => bodyLine.item)
          ? query.runSuiteQL({
            query: 'select tl.id, tl.item, tl.kitmemberof from transactionline tl where tl.transaction = ? and tl.kitcomponent = \'T\'',
            params: [Number(rmaId)]
          }).asMappedResults()
          : [];
        const resolvedLines = lines.map((bodyLine) => {
          const lineId = rmaLineIds[String(bodyLine.custcol_hc_order_line_id || '')];
          if (!bodyLine.item) return { bodyLine, rmaLineId: lineId };
          const member = kitMembers.find((row) => String(row.kitmemberof) === lineId && String(row.item) === String(bodyLine.item.id));
          return { bodyLine, rmaLineId: member ? String(member.id) : undefined };
        });
        const bodyLineByRmaLine = {};
        resolvedLines.filter((resolved) => resolved.rmaLineId).forEach((resolved) => {
          bodyLineByRmaLine[resolved.rmaLineId] = resolved.bodyLine;
        });

        let receipt = null;
        try {
          receipt = record.transform({
            fromType: record.Type.RETURN_AUTHORIZATION, fromId: rmaId, toType: record.Type.ITEM_RECEIPT, isDynamic: false
          });
        } catch (e) {
          if (e.name !== 'INVALID_INITIALIZE_REF') throw e;
        }

        const receivedRmaLines = {};
        if (receipt) {
          Object.keys(header).forEach((name) => {
            const fieldId = name.toLowerCase();
            receipt.setValue({ fieldId, value: valueFor(receipt.getField({ fieldId }), header[name]) });
          });

          for (let line = 0; line < receipt.getLineCount({ sublistId: 'item' }); line++) {
            const rmaLineId = String(receipt.getSublistValue({ sublistId: 'item', fieldId: 'orderline', line }));
            const bodyLine = bodyLineByRmaLine[rmaLineId];
            if (!bodyLine) {
              receipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line, value: false });
              continue;
            }
            receivedRmaLines[rmaLineId] = true;
            Object.keys(bodyLine).filter((name) => !['custcol_hc_order_line_id', 'item', 'inventoryDetail'].includes(name)).forEach((name) => {
              const fieldId = name.toLowerCase();
              const field = receipt.getSublistField({ sublistId: 'item', fieldId, line });
              receipt.setSublistValue({ sublistId: 'item', fieldId, line, value: valueFor(field, bodyLine[name]) });
            });
            const assignments = (bodyLine.inventoryDetail && bodyLine.inventoryDetail.inventoryAssignment && bodyLine.inventoryDetail.inventoryAssignment.items) || [];
            if (assignments.length) {
              const detail = receipt.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line });
              for (let assignmentLine = detail.getLineCount({ sublistId: 'inventoryassignment' }) - 1; assignmentLine >= 0; assignmentLine--) {
                detail.removeLine({ sublistId: 'inventoryassignment', line: assignmentLine });
              }
              assignments.forEach((assignment, assignmentLine) => {
                detail.insertLine({ sublistId: 'inventoryassignment', line: assignmentLine });
                Object.keys(assignment).forEach((name) => {
                  const fieldId = name.toLowerCase();
                  const field = detail.getSublistField({ sublistId: 'inventoryassignment', fieldId, line: assignmentLine });
                  detail.setSublistValue({ sublistId: 'inventoryassignment', fieldId, line: assignmentLine, value: valueFor(field, assignment[name]) });
                });
              });
            }
          }
        }

        resolvedLines.filter((resolved) => !receivedRmaLines[resolved.rmaLineId]).forEach(({ bodyLine }) => {
          const omsLineId = String(bodyLine.custcol_hc_order_line_id || '');
          missingLines.push(bodyLine.item ? `${omsLineId}/${bodyLine.item.id}` : omsLineId);
        });
        if (missingLines.length) {
          throw error.create({ name: 'LINE_NOT_OPEN', message: `RMA ${rmaId} has no open line for ${missingLines.join(', ')}` });
        }
        receiptId = String(receipt.save());
      }

      return { id: receiptId, existing };
    } catch (e) {
      errorName = e.name;
      throw e;
    } finally {
      log.audit({
        title: `ItemReceipt [External ID: ${body.externalId || ''}]`,
        details: JSON.stringify({
          rmaId,
          id: receiptId,
          existing,
          missingLines: missingLines.length ? missingLines : undefined,
          missingFields: missingFields.length ? missingFields : undefined,
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
