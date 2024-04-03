/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {
        const getInputData = (inputContext) => {
            // Get item receipt search query
            var inventoryTransferSearch = search.load({ id: 'customsearch_hc_exp_wh_to_fulfillment' });
            return inventoryTransferSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var fulfillmentInternalId = contextValues.values.internalid.value;
            var productInternalId = contextValues.values.item.value;
            var lineId = contextValues.values.line;
            var quantity = contextValues.values.quantity;
            var locationInternalId = contextValues.values.location.value;
            var destinationLocationId = contextValues.values.transferlocation.value;
            var trackingNumber = contextValues.values.trackingnumbers;
            if (trackingNumber && trackingNumber.includes("<BR>")) {
                trackingNumber = trackingNumber.replaceAll('<BR>', ' | ');
            }
            var transferOrderName = contextValues.values.createdfrom.text; 
            var transferOrderId = contextValues.values.createdfrom.value;
            var transferOrderAttr = 'EXTERNAL_ORDER_ID:' + transferOrderId + '|' + 'EXTERNAL_ORDER_NAME:' + transferOrderName;
            
            var orderline = null;
            if (fulfillmentInternalId) {
                
                //Load sales order object
                var fulfillmentRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT, 
                    id: fulfillmentInternalId,
                    isDynamic: false
                });
                var lineCnt = fulfillmentRecord.getLineCount({sublistId: 'item'});
                for (var i = 0; i < lineCnt; i++) {
                    var fulfillmentLineId = fulfillmentRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: i
                    });
                    if (fulfillmentLineId === lineId) {
                        orderline = fulfillmentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'orderline',
                            line: i
                        });

                    }
                
                }
                
                var id = record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentInternalId,
                    values: {
                        custbody_hc_fulfillment_exported: true
                    }
                }); 
            }
            if (orderline) {
                var transferFulfillmentData = {
                    'externalId': fulfillmentInternalId,
                    'productSku': productInternalId,
                    'idType': "NETSUITE_PRODUCT_ID",
                    'quantity': quantity,
                    'sourceFacilityId': locationInternalId,
                    'destinationFacilityId': destinationLocationId,
                    'lineId': orderline,
                    'shipmentType': "IN_TRANSFER",
                    'trackingNumber': trackingNumber,
                    'transferOrderAttr': transferOrderAttr
                };
            
                mapContext.write({
                    key: contextValues.id + lineId,
                    value: transferFulfillmentData
                });
            }
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var keyId = reduceContext.key; 

            var content = contextValues.externalId + ',' + contextValues.productSku + ',' + contextValues.idType + ',' + contextValues.quantity + ',' + contextValues.sourceFacilityId + ',' + contextValues.destinationFacilityId + ',' + contextValues.lineId + ',' + contextValues.trackingNumber + ',' + contextValues.transferOrderAttr + ',' + contextValues.shipmentType + '\n';
            reduceContext.write(keyId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'external-shipment-id,product-sku,id-type,quantity,origin-facility-id,destination-facility-id,item-external-id,tracking-number,shipment-attribute,shipment-type\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-ExportWHTOFulfillment.csv';
                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

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

                    sftpDirectory = sftpDirectory + 'transferorder';
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
            
                    if (fileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                        name:"FILE_IS_TOO_BIG",
                        message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/fulfillment/',
                        file: fileObj
                    });
                    log.debug("Transfer Order WH Fulfillment CSV Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading transfer order WH fulfillment csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading transfer order WH fulfillment csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });