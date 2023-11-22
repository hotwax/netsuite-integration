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
            path: 'transferorder/fulfillment-nifi'
        });
        
        connection.makeDirectory({
            path: 'purchaseorder'
        });
        connection.makeDirectory({
            path: 'purchaseorder/fulfillment'
        });

        connection.makeDirectory({
            path: 'inventoryitem'
        });
        connection.makeDirectory({
            path: 'inventoryitem/csv'
        });

        connection.makeDirectory({
            path: 'salesorder'
        });
        connection.makeDirectory({
            path: 'salesorder/import'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderidentification'
        });
        connection.makeDirectory({
            path: 'salesorder/import/orderitemattribute'
        });
        connection.makeDirectory({
            path: 'salesorder/import/fulfillment-nifi'
        });

        
        connection.makeDirectory({
            path: 'product'
        });
        connection.makeDirectory({
            path: 'product/csv'
        });

        connection.makeDirectory({
            path: 'discountitem'
        });
        connection.makeDirectory({
            path: 'discountitem/import'
        });
        connection.makeDirectory({
            path: 'discountitem/delete'
        });

        connection.makeDirectory({
            path: 'customer'
        });
        connection.makeDirectory({
            path: 'customer/import'
        });
        connection.makeDirectory({
            path: 'historicalshopifycustomer'
        });
        connection.makeDirectory({
            path: 'historicalshopifycustomer/csv'
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