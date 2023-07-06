/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/record', 'N/error'], function (search, record, error) {
    function execute(context) {
      try {
        var searchId = 'customsearch_export_salesorder_for_cd'; // Saved Search Id to fetch sales orders which don't have customer deposit record
      
        var savedSearch = search.load({ id: searchId });
    
        // Run the search
        var searchResult = savedSearch.run().getRange({ start: 0, end: 100 });
      
        // If the search returned no results, do not create the CSV file
        if (searchResult.length === 0) {
          log.debug('No results found. Skipping CSV file creation.');
          return;
        }

        // Check Shopify Payment Method is created or not 
        var shopifyPaymentMethodId = search
            .create({
              type: search.Type.PAYMENT_METHOD,
              filters: [['name', 'is', 'Shopify Payment']],
              columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 }).map(function (result) {
            return result.getValue('internalid');
        })[0];

        // Made Archive Fulfilled Transfer Order CSV folder in NetSuite File Cabinet
        if (shopifyPaymentMethodId == null) {
            var shopifyPayment = record.create({ type: record.Type.PAYMENT_METHOD});
            shopifyPayment.setValue({ fieldId: 'name', value: 'Shopify Payment' });
            shopifyPayment.setValue({ fieldId: 'methodtype', value: 9 });
            shopifyPaymentMethodId = shopifyPayment.save();
            log.debug("Made Shopify Payment Method ! " + shopifyPaymentMethodId);
        } 

        for (var index = 0; index < searchResult.length; index++) {
            var totalAmount = 0;
            var orderId = searchResult[index].getValue({
                name: 'internalId'
            });
            
            var date = searchResult[index].getValue({
                name: 'lastmodifieddate'
            });
            
            if (orderId) {
              var orderRecord = record.load({
                type: record.Type.SALES_ORDER, 
                id: orderId,
                isDynamic: false,
              });
              var total = orderRecord.getValue({fieldId: 'total'});
              
              var itemLineCnt = orderRecord.getLineCount({sublistId: 'item'});
              var cancelledAmount = 0;
              
              for (var lineId = 0; lineId < itemLineCnt; lineId++) {
                  var isClosed = orderRecord.getSublistValue({
                      sublistId: 'item',
                      fieldId: 'isclosed',
                      line: lineId
                  });

                  if (isClosed) {
                      var amount = orderRecord.getSublistValue({
                          sublistId: 'item',
                          fieldId: 'amount',
                          line: lineId
                      });
                      var taxRate = orderRecord.getSublistValue({
                          sublistId: 'item',
                          fieldId: 'taxrate1',
                          line: lineId
                      });

                      var taxAmount = amount * (taxRate/100); 
                      cancelledAmount = cancelledAmount + amount + taxAmount;
                  }       
              }
              
              totalAmount = total - cancelledAmount; 
            } 
            try {
                if (totalAmount > 0) {
                    var customerDeposit = record.create({
                        type: record.Type.CUSTOMER_DEPOSIT, 
                        isDynamic: false,
                        defaultValues: {
                            salesorder: orderId 
                        }
                     });

                    customerDeposit.setValue({fieldId: 'payment', value: totalAmount});
                    customerDeposit.setValue({fieldId: 'trandate', value: new Date(date)});
                    customerDeposit.setValue({fieldId: 'paymentmethod', value: shopifyPaymentMethodId});

                    var customerDepositId = customerDeposit.save();
                    log.debug("customer deposit is created with id " + customerDepositId);
                }

            } catch (e) {
                log.error({
                    title: 'Error in creating customer deposit records for sales order ' + orderId,
                    details: e,
                });
            }
        }
        
      } catch (e) {
        log.error({
          title: 'Error in creating customer deposit for sales orders',
          details: e,
        });
        throw error.create({
          name: "Error in creating customer deposit for sales orders",
          message: e
        });
      }
    }
    return {
      execute: execute
    };
  });