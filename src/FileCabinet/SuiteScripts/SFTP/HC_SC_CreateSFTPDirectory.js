/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/sftp', 'N/error', 'N/search'], function (sftp, error, search) {
    function execute(context) {
      try {
        //Get Custom Record Type SFTP details
        var customRecordSFTPSearch = search.create({
          type: 'customrecord_ns_sftp_configuration',
          columns: [
              'custrecord_ns_sftp_server',
              'custrecord_ns_sftp_userid',
              'custrecord_ns_sftp_port_no',
              'custrecord_ns_sftp_host_key',
              'custrecord_ns_sftp_guid',
              'custrecord_ns_sftp_default_file_dir'
          ]
          
        });
        var sftpSearchResults = customRecordSFTPSearch.run().getRange({
            start: 0,
            end: 1
        });
  
        var sftpSearchResult = sftpSearchResults[0];
        
        var sftpUrl = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_server'
        });

        var sftpUserName = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_userid'
        });

        var sftpPort = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_port_no'
        });

        var hostKey = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_host_key'
        });
        
        var sftpKeyId = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_guid'
        });

        var sftpDirectory = sftpSearchResult.getValue({
            name: 'custrecord_ns_sftp_default_file_dir'
        });

        sftpDirectory = sftpDirectory;
        sftpPort = parseInt(sftpPort);

        var connection = sftp.createConnection({
            username: sftpUserName,
            keyId: sftpKeyId,
            url: sftpUrl,
            port: sftpPort,
            directory: sftpDirectory,
            hostKey: hostKey
        });
        log.debug("Connection established successfully with SFTP server!");
        
        connection.makeDirectory({
            path: 'transferorder'
        });
        connection.makeDirectory({
            path: 'transferorder/fulfillment'
        });
        connection.makeDirectory({
            path: 'transferorder/fulfillment/archive'
        });

        connection.makeDirectory({
            path: 'transferorder/oms-fulfillment'
        });
        connection.makeDirectory({
            path: 'transferorder/oms-fulfillment/error'
        });
        connection.makeDirectory({
            path: 'transferorder/oms-fulfillment/archive'
        });


        connection.makeDirectory({
            path: 'transferorder/csv'
        });
        connection.makeDirectory({
            path: 'transferorder/csv/archive'
        });

        connection.makeDirectory({
            path: 'transferorder/fulfillment-nifi'
        });
        connection.makeDirectory({
            path: 'transferorder/fulfillment-nifi/archive'
        });
        connection.makeDirectory({
            path: 'transferorder/receipt'
        });
        connection.makeDirectory({
            path: 'transferorder/receipt/archive'
        });
        connection.makeDirectory({
            path: 'transferorder/receipt/error'
        });

        connection.makeDirectory({
            path: 'salesorder'
        });
        connection.makeDirectory({
            path: 'salesorder/customerdeposit'
        });
        connection.makeDirectory({
            path: 'salesorder/customerdeposit/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/customerdeposit/error'
        });

        connection.makeDirectory({
            path: 'salesorder/customer-refund'
        });
        connection.makeDirectory({
            path: 'salesorder/customer-refund/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/customer-refund/error'
        });

        connection.makeDirectory({
            path: 'salesorder/export'
        });
        connection.makeDirectory({
            path: 'salesorder/export/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/export/error'
        });
        connection.makeDirectory({
            path: 'salesorder/export/failed'
        });
        connection.makeDirectory({
            path: 'salesorder/export/required_fields_missing'
        });

        connection.makeDirectory({
            path: 'salesorder/import'
        });
        connection.makeDirectory({
            path: 'salesorder/import/fulfillment'
        });
        connection.makeDirectory({
            path: 'salesorder/import/fulfillment/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderidentification'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderidentification/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderitemattribute'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderitemattribute/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/import/fulfillment-nifi'
        });
        connection.makeDirectory({
            path: 'salesorder/import/fulfillment-nifi/archive'
        });

        connection.makeDirectory({
            path: 'salesorder/invoice'
        });
        connection.makeDirectory({
            path: 'salesorder/invoice/error'
        });

        connection.makeDirectory({
            path: 'salesorder/update'
        });
        connection.makeDirectory({
            path: 'salesorder/update/archive'
        });
        connection.makeDirectory({
            path: 'salesorder/update/error'
        });
        connection.makeDirectory({
            path: 'salesorder/update/failed'
        });

        connection.makeDirectory({
            path: 'salesorder/rejectedorderitem'
        });
        connection.makeDirectory({
            path: 'salesorder/rejectedorderitem/archive'
        });

        connection.makeDirectory({
            path: 'salesorder/giftcard-fulfillment'
        });
        connection.makeDirectory({
            path: 'salesorder/giftcard-fulfillment/archive'
        });

        connection.makeDirectory({
            path: 'discountitem'
        });
        connection.makeDirectory({
            path: 'discountitem/import'
        });
        connection.makeDirectory({
            path: 'discountitem/import/archive'
        });
        connection.makeDirectory({
            path: 'discountitem/delete'
        });
        connection.makeDirectory({
            path: 'discountitem/delete/archive'
        });

        connection.makeDirectory({
            path: 'customer'
        });
        connection.makeDirectory({
            path: 'customer/import'
        });
        connection.makeDirectory({
            path: 'customer/import/archive'
        });
        connection.makeDirectory({
            path: 'customer/export'
        });
        connection.makeDirectory({
            path: 'customer/export/archive'
        });
        connection.makeDirectory({
            path: 'customer/export/error'
        });
        connection.makeDirectory({
            path: 'customer/export/failed'
        });
        connection.makeDirectory({
            path: 'customer/export/required_fields_missing'
        });

        connection.makeDirectory({
            path: 'historicalshopifycustomer'
        });
        connection.makeDirectory({
            path: 'historicalshopifycustomer/csv'
        });
        connection.makeDirectory({
            path: 'historicalshopifycustomer/csv/archive'
        });

        connection.makeDirectory({
            path: 'cashsale'
        });
        connection.makeDirectory({
            path: 'cashsale/export'
        });
        connection.makeDirectory({
            path: 'cashsale/export/archive'
        });
        connection.makeDirectory({
            path: 'cashsale/export/error'
        });
        connection.makeDirectory({
            path: 'cashsale/export/failed'
        });
        connection.makeDirectory({
            path: 'cashsale/export/required_fields_missing'
        });

        connection.makeDirectory({
            path: 'fulfilledsalesorder'
        });
        connection.makeDirectory({
            path: 'fulfilledsalesorder/export'
        });
        connection.makeDirectory({
            path: 'fulfilledsalesorder/export/archive'
        });
        connection.makeDirectory({
            path: 'fulfilledsalesorder/export/error'
        });

        connection.makeDirectory({
            path: 'inventoryadjustment'
        });
        connection.makeDirectory({
            path: 'inventoryadjustment/csv'
        });
        connection.makeDirectory({
            path: 'inventoryadjustment/archive'
        });
        connection.makeDirectory({
            path: 'inventoryadjustment/error'
        });
        connection.makeDirectory({
            path: 'inventoryadjustment/failed'
        });
        connection.makeDirectory({
            path: 'inventoryadjustment/required_fields_missing'
        });

        connection.makeDirectory({
            path: 'inventoryitem'
        });
        connection.makeDirectory({
            path: 'inventoryitem/csv'
        });
        connection.makeDirectory({
            path: 'inventoryitem/csv/archive'
        });

        connection.makeDirectory({
            path: 'product'
        });
        connection.makeDirectory({
            path: 'product/csv'
        });
        connection.makeDirectory({
            path: 'product/csv/archive'
        });

        connection.makeDirectory({
            path: 'purchaseorder'
        });
        connection.makeDirectory({
            path: 'purchaseorder/fulfillment'
        });
        connection.makeDirectory({
            path: 'purchaseorder/fulfillment/archive'
        });
        connection.makeDirectory({
            path: 'purchaseorder/receipt'
        });
        connection.makeDirectory({
            path: 'purchaseorder/receipt/archive'
        });
        connection.makeDirectory({
            path: 'purchaseorder/receipt/error'
        });

        connection.makeDirectory({
            path: 'inventorytransfer'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/csv'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/archive'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/error'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/failed'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/required_fields_missing'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/import'
        });
        connection.makeDirectory({
            path: 'inventorytransfer/import/archive'
        });

        connection.makeDirectory({
            path: 'itemreceipt'
        });
        connection.makeDirectory({
            path: 'itemreceipt/csv'
        });
        connection.makeDirectory({
            path: 'itemreceipt/csv/archive'
        });

        connection.makeDirectory({
            path: 'salesorder_audit_report'
        });
        connection.makeDirectory({
            path: 'salesorder_audit_report/csv'
        });
        connection.makeDirectory({
            path: 'salesorder_audit_report/csv/archive'
        });
        
      } catch (e) {
        log.error({
          title: 'Error in making SFTP Directory',
          details: e,
        });
        throw error.create({
          name:"Error in making SFTP Directory",
          message: e
        });
      }
   }
   return {
     execute: execute
   };
});