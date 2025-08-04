/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

  function pageInit(context) {
    const currentRecord = context.currentRecord;
    const mode = context.mode;

    if (mode === 'copy') {
      const tranId = currentRecord.getValue({ fieldId: 'tranid' }) || '[Not Assigned Yet]';

      console.debug('Resetting Field', `Unchecking 'HC Order Exported' for TO: ${tranId}`);

      currentRecord.setValue({
        fieldId: 'custbody_hc_order_exported',
        value: false
      });
    }
  }

  return {
    pageInit
  };
});