/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/error', 'N/runtime', 'N/log'], (record, error, runtime, log) => {

  function toInt(v, fieldName) {
    const n = parseInt(v, 10);
    if (!n || isNaN(n)) {
      throw error.create({
        name: 'INVALID_INPUT',
        message: `${fieldName} must be a valid integer. Got: ${v}`
      });
    }
    return n;
  }

  /**
   * POST /app/site/hosting/restlet.nl?script=XXX&deploy=1
   * Body:
   * {
   *   "rmaId": "123",
   *   "location": { "id": "43" }
   * }
   */
  function post(requestBody) {
    try {
      const rmaId = toInt(requestBody?.rmaId, 'rmaId');
      const locationId = toInt(requestBody?.location?.id, 'location.id');

      // 1) Transform RMA -> Credit Memo
      // Return Authorization record type is record.Type.RETURN_AUTHORIZATION
      const cm = record.transform({
        fromType: record.Type.RETURN_AUTHORIZATION,
        fromId: rmaId,
        toType: record.Type.CREDIT_MEMO,
        isDynamic: true
      });

      // Set header location (required in your REST API scenario)
      cm.setValue({ fieldId: 'location', value: locationId });

      // Optional: set externalid for idempotency (recommended)
      // If you call this endpoint twice, you'd otherwise create duplicates.
      // Uncomment if you want:
      // cm.setValue({ fieldId: 'externalid', value: `RMA-${rmaId}-LOC-${locationId}` });

      const creditMemoId = cm.save({ enableSourcing: true, ignoreMandatoryFields: false });

      // 2) Create Customer Refund and apply the credit memo
      let customerRefundId;

      // Load CM to get customer/entity
      const cmLoaded = record.load({
        type: record.Type.CREDIT_MEMO,
        id: creditMemoId,
        isDynamic: true
      });

      const customerId = cmLoaded.getValue({ fieldId: 'entity' });
      if (!customerId) {
        throw error.create({
          name: 'MISSING_CUSTOMER',
          message: `Credit Memo ${creditMemoId} has no entity/customer.`
        });
      }

      const refund = record.create({
        type: record.Type.CUSTOMER_REFUND,
        isDynamic: true,
        defaultValues: { entity: customerId }
      });

      refund.setValue({ fieldId: 'customer', value: customerId });

      // Optional but often good to align
      try { refund.setValue({ fieldId: 'location', value: locationId }); } catch (e) { }

      // If mandatory in your account, you MUST set these (or pass via request)
      // refund.setValue({ fieldId: 'paymentmethod', value: 123 });
      // refund.setValue({ fieldId: 'account', value: 456 });

      // Apply the credit memo on the "apply" sublist
      const lineCount = refund.getLineCount({ sublistId: 'apply' });
      let applied = false;

      for (let i = 0; i < lineCount; i++) {
        refund.selectLine({ sublistId: 'apply', line: i });
        const internalId = refund.getCurrentSublistValue({ sublistId: 'apply', fieldId: 'internalid' });

        if (parseInt(internalId, 10) === creditMemoId) {
          refund.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });

          // If you want full amount, NetSuite usually sources it automatically when apply=true.
          // If you need to force an amount:
          // const due = refund.getCurrentSublistValue({ sublistId: 'apply', fieldId: 'due' });
          // refund.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: due });

          refund.commitLine({ sublistId: 'apply' });
          applied = true;
          break;
        }
      }

      if (!applied) {
        throw error.create({
          name: 'CREDIT_NOT_FOUND_ON_REFUND',
          message: `Credit Memo ${creditMemoId} was not available to apply on the Customer Refund.`
        });
      }

      customerRefundId = refund.save({ enableSourcing: true, ignoreMandatoryFields: false });

      return {
        ok: true,
        rmaId,
        locationId,
        creditMemoId,
        customerRefundId
      };

    } catch (e) {
      log.error('RMA->CM->Refund RESTlet error', e);
      return {
        ok: false,
        name: e.name || 'UNEXPECTED_ERROR',
        message: e.message || String(e),
        stack: e.stack || null
      };
    }
  }

  return { post };
});