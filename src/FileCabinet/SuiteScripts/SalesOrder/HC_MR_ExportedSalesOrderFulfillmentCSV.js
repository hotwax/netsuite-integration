/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {
        const getInputData = (inputContext) => {
            // Get sales order fulfillment search query
            var salesOrderFulfillmentSearch = search.load({ id: 'customsearch_hc_export_so_fulfillment' });
            return salesOrderFulfillmentSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var orderId = contextValues.values.formulatext;
            var orderItemSeqId = contextValues.values.custcol_hc_order_line_id;
            var externalFacilityId = contextValues.values.location.value;
            var shippedDate = contextValues.values.lastmodifieddate;
            var quantity = contextValues.values.quantity;
            var trackingNumber = contextValues.values.trackingnumbers;
            if (trackingNumber && trackingNumber.includes("<BR>")) {
                trackingNumber = trackingNumber.replaceAll('<BR>', ' | ');
            }
            var shippingCarrier = contextValues.values.shipcarrier.text;
            var shippingMethod = contextValues.values.shipmethod.text;
            var shippingMethodId = contextValues.values.shipmethod.value;
            var fulfillmentInternalId = contextValues.id; 

            var shipmentData = {
                'orderId': orderId,
                'orderItemSeqId': orderItemSeqId,
                'externalFacilityId': externalFacilityId,
                'shippedDate': shippedDate,
                'quantity': quantity,
                'trackingNumber' : trackingNumber,
                'shippingCarrier': shippingCarrier,
                'shippingMethod' : shippingMethod,
                'shippingMethodId': shippingMethodId
            };
            if (fulfillmentInternalId) {
                var id = record.submitFields({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentInternalId,
                    values: {
                        custbody_hc_fulfillment_exported: true
                    }
                });
            }
            
            mapContext.write({
                key: contextValues.id + orderItemSeqId,
                value: shipmentData
            });
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var shipmentId = reduceContext.key; 

            var content = contextValues.orderId + ',' + contextValues.orderItemSeqId + ',' + contextValues.externalFacilityId + ',' + contextValues.shippedDate + ',' + contextValues.quantity + ',' + contextValues.trackingNumber + ',' + contextValues.shippingCarrier + ',' + contextValues.shippingMethod + ',' + contextValues.shippingMethodId + '\n';
 
            reduceContext.write(shipmentId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'orderId,orderItemSeqId,externalFacilityId,shippedDate,quantity,trackingNumber,carrier,shippingMethod,shippingMethodId\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-SalesOrderFulfillment.csv';
                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

                    // Establish a connection to a remote FTP server
                    /* The host key can be obtained using OpenSSH's ssh-keyscan tool:
                    ssh-keyscan -t <hostKeyType> -p <port> <hostDomain>
                    Example: ssh-keyscan -t ECDSA -p 235 hc-uat.hotwax.io 
                    */

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

                    sftpDirectory = sftpDirectory + 'salesorder';
                    sftpPort = parseInt(sftpPort);
        
                    var connection = sftp.createConnection({
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
                        directory: '/import/fulfillment-nifi/',
                        file: fileObj
                    });
                    log.debug("Sales Order Fulfillment CSV File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading sales order fulfillment csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading sales order fulfillment csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });
