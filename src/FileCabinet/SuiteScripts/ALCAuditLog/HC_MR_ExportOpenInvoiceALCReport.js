/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/task', 'N/error'],
    (file, record, search, sftp, task, error) => {
        const getInputData = (inputContext) => {
            // Get openSalesOrderInvoice search query
            var openSalesOrderInvoice = search.load({ id: 'customsearch_hc_alc_open_invoice' });
            return openSalesOrderInvoice;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var invoiceInternalId = contextValues.values.internalid.value;
            var shopifyOrderName = contextValues.values.otherrefnum;
            var shopifyOrderId = contextValues.values.custbody_celigo_etail_order_id;
            var salesOrderInternalId = contextValues.values["internalid.createdFrom"].value;
            var hcOrderId = contextValues.values.custbody_hc_order_id;
            var invoiceNumber = contextValues.values.tranid;
            var invoiceTotal = contextValues.values.total;
            var invoiceDate = contextValues.values.formulatext;
            var amountRemaining = contextValues.values.amountremaining;
            
            var invoiceData = {
                invoiceInternalId: invoiceInternalId,
                shopifyOrderName: shopifyOrderName,
                shopifyOrderId: shopifyOrderId,
                salesOrderInternalId: salesOrderInternalId,
                hcOrderId: hcOrderId,
                invoiceNumber: invoiceNumber,
                invoiceTotal: invoiceTotal,
                amountRemaining: amountRemaining,
                invoiceDate: invoiceDate
            };
            
            mapContext.write({
                key: contextValues.id,
                value: invoiceData
            });
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var invoiceId = reduceContext.key; 

            var content = contextValues.invoiceInternalId + ',' + contextValues.shopifyOrderName + ',' + contextValues.shopifyOrderId + ',' + contextValues.salesOrderInternalId + ',' + contextValues.hcOrderId + ',' + contextValues.invoiceNumber + ',' + contextValues.invoiceTotal + ',' + contextValues.amountRemaining + ',' + contextValues.invoiceDate + '\n';
            reduceContext.write(invoiceId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'INVOICE_INTERNAL_ID,SHOPIFY_ORDER_NAME,SHOPIFY_ORDER_ID,SALES_ORDER_INTERNAL_ID,HC_ORDER_ID,INVOICE_NUMBER,INVOICE_TOTAL,AMOUNT_DUE,INVOICE_DATE\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  'Order_Invoice-' + summaryContext.dateCreated + '.csv';
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

                    sftpDirectory = sftpDirectory + 'alc-audit-data';
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
                        directory: '/',
                        file: fileObj
                    });
                    log.debug("Sales Order Invoice CSV File Uploaded Successfully to SFTP server with file" + fileName);
                }
            } catch (e) {
                log.error({
                    title: 'Error in exporting and uploading Sales Order Invoice csv files',
                    details: e,
                });
                throw error.create({
                    name:"Error in exporting and uploading Sales Order Invoice csv files",
                    message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });
