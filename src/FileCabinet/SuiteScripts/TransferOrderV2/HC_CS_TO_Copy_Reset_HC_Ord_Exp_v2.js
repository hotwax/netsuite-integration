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

         // Uncheck the "HC Order Exported" checkbox
         currentRecord.setValue({
            fieldId: 'custbody_hc_order_exported',
            value: false
         });

         // Clear the "HC Order ID" field (free-form text)
         currentRecord.setValue({
            fieldId: 'custbody_hc_order_id',
            value: ''
         });
      }
   }

   return {
      pageInit
   };
});