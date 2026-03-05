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

         var lineCount = currentRecord.getLineCount({ sublistId: 'item' });

         for (var i = 0; i < lineCount; i++) {

            currentRecord.selectLine({
               sublistId: 'item',
               line: i
            });

            currentRecord.setCurrentSublistValue({
               sublistId: 'item',
               fieldId: 'custcol_hc_closed',
               value: false
            });

            currentRecord.commitLine({
               sublistId: 'item'
            });
         }
      }
   }

   return {
      pageInit
   };
});