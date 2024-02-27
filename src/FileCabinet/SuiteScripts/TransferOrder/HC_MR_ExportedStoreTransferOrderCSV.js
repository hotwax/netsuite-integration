/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/error', 'N/file', 'N/format', 'N/record', 'N/search', 'N/sftp'],
 
    (error, file, format, record, search, sftp) => {
        const getInputData = (inputContext) => {
               
            var now = format.format({value : new Date(), type: format.Type.DATETIME});

            var nowDateSplit = now.split(" ");

            var date =  nowDateSplit[0];
            var time =  nowDateSplit[1];
            var ampm =  nowDateSplit[2];

            var timewithoutsecond = time.split(":").slice(0, 2).join(":");

            var dateStringWithoutSeconds = date + " " + timewithoutsecond + " " + ampm;

            var customRecordSearch = search.create({
                type: "customrecord_hc_last_runtime_export",
                columns: ["custrecord_store_transfer_order_ex_date"],
            });

            var searchResults = customRecordSearch.run().getRange({
                start: 0,
                end: 1,
            });
               
            var searchResult = searchResults[0];
            var lastStoreTransferOrderExportDate = searchResult.getValue({
                 name: "custrecord_store_transfer_order_ex_date",
            });

            var lastStoreTransferOrderExportSplit = lastStoreTransferOrderExportDate.split(' ');
            var StoreTransferOrderExportDate = lastStoreTransferOrderExportSplit[0];
            var StoreTransferOrderExportTime = lastStoreTransferOrderExportSplit[1];
            var StoreTransferOrderExportAMPM = lastStoreTransferOrderExportSplit[2];

            var StoreTransferOrderExportTimeWithoutSeconds = StoreTransferOrderExportTime.split(":").splice(0, 2).join(":");

            var lastStoreTransferOrderExportDateString = StoreTransferOrderExportDate + " " + StoreTransferOrderExportTimeWithoutSeconds + " " + StoreTransferOrderExportAMPM;
             
            // Get StoreTransferOrder search query
            var StoreTransferOrderSearch = search.load({ id: 'customsearch_hc_exp_store_transfer_order' });

            var defaultFilters = StoreTransferOrderSearch.filters;
         
            defaultFilters.push(search.createFilter({
                  name: "datecreated",
                  operator: search.Operator.WITHIN,
                  values: lastStoreTransferOrderExportDateString, dateStringWithoutSeconds
            }));
               
            StoreTransferOrderSearch.filters = defaultFilters
            return StoreTransferOrderSearch
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var internalid = contextValues.values.internalid.value;
            var productSku = contextValues.values.item.value;
            var lineId = contextValues.values.transferorderitemline;
            var quantity = contextValues.values.quantity;
            var locationInternalId = contextValues.values.location.value;
            var destinationLocationId = contextValues.values.transferlocation.value;
            var date = contextValues.values.formulatext;
            var shipcarrier = contextValues.values.shipcarrier.text;
            var shipmethod = contextValues.values.shipmethod.text;            
            var transferOrderNumber = contextValues.values.tranid;
           
            if (internalid) {
                var id = record.submitFields({
                    type: record.Type.TRANSFER_ORDER,
                    id: internalid,
                    values: {
                        custbody_hc_order_exported: true
                    }
                }); 
            } 

            var storetransferorderdata = {
                'externalId': internalid,
                'productStoreId': 'STORE',
                'statusID': 'ORDER_CREATED',
                'sourceFacilityId': locationInternalId,
                'destinationFacilityId': destinationLocationId,
                'orderTypeId':'TRANSFER_ORDER',
                'orderItemTypeId': 'PRODUCT_ORDER_ITEM',
                'itemStatusId': 'ITEM_CREATED',
                'date':date,
                'productIdValue' : productSku,
                'productIdType': 'NETSUITE_PRODUCT_ID',
                'lineId': lineId,
                'quantity': quantity,
                'unitListPrice': 0,
                'unitPrice': 0,
                'itemTotalDiscount': 0,
                'grandTotal': 0,
                'shipmethod': shipmethod,
                'shipcarrier': shipcarrier,
                'orderName': transferOrderNumber
            };
            
            mapContext.write({
                key: contextValues.id + lineId,
                value: storetransferorderdata
            });
        }

        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var storetransferOrderId = reduceContext.key; 

            var content = contextValues.externalId + ',' + contextValues.productStoreId + ',' + contextValues.statusID + ',' + contextValues.sourceFacilityId + ',' + contextValues.destinationFacilityId + ',' + contextValues.orderTypeId + ',' + contextValues.orderItemTypeId + ',' + contextValues.itemStatusId + ',' + contextValues.date + ',' + contextValues.productIdValue + ',' + contextValues.productIdType + ',' + contextValues.lineId + ',' + contextValues.quantity + ',' + contextValues.unitListPrice + ',' + contextValues.unitPrice + ',' + contextValues.itemTotalDiscount + ',' + contextValues.grandTotal + ',' + contextValues.shipmethod + ',' + contextValues.shipcarrier + ',' + contextValues.orderName + '\n';
            reduceContext.write(storetransferOrderId, content);
        }

        const summarize = (summaryContext) => {

            try {
                var fileLines = 'external-id,product-store-id,status-id,external-facility-id,external-placing-facility-id,order-type-id,order-item-type-id,item-status-id,entry-date,product-id-value,product-id-type,item-external-id,quantity,unit-list-price,unit-price,item-total-discount,grand-total,shipment-method-type-id,carrier-party-id,order-name\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+ totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-ExportStoreTransferOrder.csv';
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
                        directory: '/csv/',
                        file: fileObj
                    });
                    log.debug("Store Transfer Order CSV File Uploaded Successfully to SFTP server with file" + fileName);
                    
            
                    var currentDate = format.format({value : summaryContext.dateCreated, type: format.Type.DATETIME});

                    //Get Custom Record Type internal id
                    var customRecordHCExSearch = search.create({
                        type: 'customrecord_hc_last_runtime_export',
                        columns: ['internalid']
                    });
                    var searchResults = customRecordHCExSearch.run().getRange({
                        start: 0,
                        end: 1
                    });
                
                    var searchResult = searchResults[0];
                    var lastRuntimeExportInternalId = searchResult.getValue({
                        name: 'internalid'
                    });

                    // save last store transfer order export date
                    record.submitFields({
                        type: 'customrecord_hc_last_runtime_export',
                        id: lastRuntimeExportInternalId,
                        values: {
                            custrecord_store_transfer_order_ex_date : currentDate
                        }
                    });
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading store transfer order csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading store transfer order csv files",
                message: e
                });
            }   
        }
        return {getInputData, map, reduce, summarize}
});