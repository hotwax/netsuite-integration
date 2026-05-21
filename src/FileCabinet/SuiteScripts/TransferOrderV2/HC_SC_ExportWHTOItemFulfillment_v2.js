/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/record', 'N/search', 'N/file', 'N/sftp', 'N/error', 'N/runtime'], 
    (record, search, file, sftp, error, runtime) => {
    
    const execute = (context) => {
        try {
            var usageThreshold = 1000; // Set a threshold for remaining usage units
            var scriptObj = runtime.getCurrentScript();

            // 1. Get the eligible item fulfillments (e.g., via saved search)
            const warehouseFulfillmentSearch = search.load({ id: 'customsearch_hc_sc_wh_to_fulfillment_v2' });
            
            const fulfillmentsDataMap = {};
            const internalIdList = new Set();
            
            // Loop through the search results to get header-level information
            const searchResults = warehouseFulfillmentSearch.run().getRange({ start: 0, end: 50 });
            
            searchResults.forEach(result => {
                const fulfillmentId = result.getValue({ name: 'internalid' });
                const transferOrderId = result.getValue({ name: 'createdfrom' });
                const shippedDate = result.getValue({ name: 'formulatext' }); // Replace with actual date field if needed
                const trackingNumbersRaw = result.getValue({ name: 'trackingnumbers' });
                
                if (!fulfillmentsDataMap[fulfillmentId]) {
                    let trackingNumberList = [];
                    if (trackingNumbersRaw) {
                        trackingNumberList = trackingNumbersRaw.split('<BR>').map(s => s.trim()).filter(Boolean);
                    }
                    
                    fulfillmentsDataMap[fulfillmentId] = {
                        externalId: fulfillmentId,
                        transferOrderId: transferOrderId,
                        shippedDate: shippedDate,
                        trackingNumberList: trackingNumberList,
                        items: []
                    };
                    internalIdList.add(fulfillmentId);
                }
            });

            const finalJsonData = [];

            // 2. Load each Fulfillment Record to get the exact Item Details
            for (const fulfillmentId of internalIdList) {
                if (scriptObj.getRemainingUsage() < usageThreshold) {
                    log.debug('Scheduled script has exceeded the usage unit threshold.');
                    break;
                }
                const fulfillmentData = fulfillmentsDataMap[fulfillmentId];
                
                const fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId,
                    isDynamic: false
                });

                const lineCnt = fulfillmentRecord.getLineCount({ sublistId: 'item' });
                
                for (let i = 0; i < lineCnt; i++) {
                    const itemReceive = fulfillmentRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        line: i
                    });

                    // Check if the item is actually fulfilled
                    if (itemReceive === true || itemReceive === 'T') {
                        const lineId = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'line',
                            line: i
                        });
                        
                        const orderline = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: i
                        });
                        
                        const productIdValue = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: i
                        });
                        
                        const quantity = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            line: i
                        });

                        // Calculate external IDs based on MR logic
                        const itemExtId = (Number(orderline) - 1).toString();

                        fulfillmentData.items.push({
                            externalId: lineId,
                            itemExternalId: itemExtId,
                            productIdType: "NETSUITE_PRODUCT_ID",
                            productIdValue: productIdValue.toString(),
                            quantity: parseInt(quantity)
                        });
                    }
                }

                // 3. Construct the exact JSON structure with packages array
                let packages = [];
                if (fulfillmentData.trackingNumberList.length > 0) {
                    packages = fulfillmentData.trackingNumberList.map((trackingNumber, index) => ({
                        trackingNumber: trackingNumber || null,
                        items: index === 0 ? fulfillmentData.items : [] // Items attached to the first package only
                    }));
                } else {
                    packages = [{
                        trackingNumber: null,
                        items: fulfillmentData.items
                    }];
                }

                finalJsonData.push({
                    externalId: fulfillmentData.externalId,
                    transferOrderId: fulfillmentData.transferOrderId,
                    shippedDate: fulfillmentData.shippedDate,
                    packages: packages
                });
                
                // Mark the fulfillment as exported
                record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId,
                    values: {
                        custbody_hc_fulfillment_exported: true
                    }
                });
            }

            log.debug("Number of Fulfillments Exported", finalJsonData.length);

            // At this point, finalJsonData contains exactly the JSON structure you need.
            if (finalJsonData.length > 0) {
                const dateObj = new Date();
                const fileName = 'ExportWarehouseToFulfillment-' + dateObj.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') + '.json';
                const fileObj = file.create({
                    name: fileName,
                    fileType: file.Type.JSON,
                    contents: JSON.stringify(finalJsonData, null, 2),
                    encoding: file.Encoding.UTF_8
                });

                //Get Custom Record Type SFTP details
                const customRecordSFTPSearch = search.create({
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
                const sftpSearchResults = customRecordSFTPSearch.run().getRange({ start: 0, end: 1 });
           
                if (sftpSearchResults.length > 0) {
                    const sftpSearchResult = sftpSearchResults[0];
                    
                    const sftpUrl = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_server' });
                    const sftpUserName = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_userid' });
                    let sftpPort = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_port_no' });
                    const hostKey = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_host_key' });
                    const sftpKeyId = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_guid' });
                    let sftpDirectory = sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_default_file_dir' });

                    sftpDirectory = sftpDirectory + 'transferorderv2';
                    sftpPort = parseInt(sftpPort);

                    const connection = sftp.createConnection({
                        username: sftpUserName,
                        secret: sftpKeyId,
                        url: sftpUrl,
                        port: sftpPort,
                        directory: sftpDirectory,
                        hostKey: hostKey
                    });
                    log.debug("Connection established successfully with SFTP server!");
            
                    if (fileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                            name:"FILE_IS_TOO_BIG",
                            message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/import/fulfillment-wh/',
                        file: fileObj
                    });
                    log.debug("Transfer Order WH Fulfillment JSON Uploaded Successfully to SFTP server with file " + fileName);
                } else {
                    log.error("SFTP Configuration Missing", "Could not find SFTP configuration record.");
                }
            }

            log.debug("Remaining Script Usage", runtime.getCurrentScript().getRemainingUsage());

        } catch (e) {
            log.error("Error in Scheduled Script", e);
        }
    };

    return { execute };
});
