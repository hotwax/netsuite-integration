/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp'],
    (file, record, search, sftp) => {
        // Global connection object
        let connection; 

        const setupSftpConnection = () => {
            // Establish a connection to a remote FTP server
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

            return sftp.createConnection({
                username: sftpUserName,
                secret: sftpKeyId,
                url: sftpUrl,
                port: sftpPort,
                directory: sftpDirectory,
                hostKey: hostKey
            });
        };

        const getInputData = (inputContext) => {
            // Establish a connection to a remote FTP server
            connection = setupSftpConnection(); // Initialize connection globally
            log.debug("Connection established successfully with SFTP server!");

            var list = connection.list({
                path: '/customerdeposit/',
                sort: sftp.Sort.DATE
            });

            var customerDeposit = [];
            for (var i = 0; i < list.length; i++) {
                if (!list[i].directory) {
                    var fileName = list[i].name;

                    // Download the file from the remote server
                    var downloadedFile = connection.download({
                        directory: '/customerdeposit',
                        filename: fileName
                    });
                    if (downloadedFile.size > 0) {
                        log.debug("File downloaded successfully !" + fileName);
                        var contents = downloadedFile.getContents();
                    
                        customerDeposit = JSON.parse(contents);

                        connection.move({
                            from: '/customerdeposit/' + fileName,
                            to: '/customerdeposit/archive/' + fileName
                        })
                        log.debug('File moved!');
                        break;
                    }
                }
            }
            return customerDeposit;
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var orderId = contextValues.orderId;
            var totalAmount = contextValues.totalAmount;
            var shopifyPaymentMethodId = contextValues.paymentMethod;
            var externalId = contextValues.externalId;

            try {
                if (totalAmount > 0 && orderId) {
                    var fieldLookUp = search.lookupFields({
                        type: search.Type.SALES_ORDER,
                        id: orderId,
                        columns: ['lastmodifieddate']
                    });
                    var date = fieldLookUp.lastmodifieddate;

                    var customerDeposit = record.create({
                        type: record.Type.CUSTOMER_DEPOSIT,
                        isDynamic: false,
                        defaultValues: {
                            salesorder: orderId
                        }
                    });

                    customerDeposit.setValue({ fieldId: 'payment', value: totalAmount });
                    customerDeposit.setValue({ fieldId: 'trandate', value: new Date(date) });
                    customerDeposit.setValue({ fieldId: 'paymentmethod', value: shopifyPaymentMethodId });
                    
                    if (externalId) {
                        // Set CD External Id
                        customerDeposit.setValue({
                            fieldId: 'externalid',
                            value: externalId
                        });
                    }

                    var customerDepositId = customerDeposit.save();
                    log.debug("customer deposit is created with id " + customerDepositId);
                }
            } catch (e) {
                log.error({
                    title: 'Error in creating customer deposit records for sales order ' + orderId,
                    details: e,
                });
                var errorInfo = {
                    'orderId': orderId,
                    'errorMessage': e.message
                };

                mapContext.write({
                    key: orderId + '-' + externalId,
                    value: errorInfo
                });
            }

        }

        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var errorId = reduceContext.key;

            var content = contextValues.orderId + ',' + contextValues.errorMessage + '\n';
            reduceContext.write(errorId, content);
        }

        const summarize = (summaryContext) => {

            try {
                var fileLines = 'orderId,errorMessage\n';
                var totalErrorRecordsExported = 0;

                summaryContext.output.iterator().each(function (key, value) {
                    fileLines += value;
                    totalErrorRecordsExported = totalErrorRecordsExported + 1;
                    return true;
                });

                log.debug("====totalErrorRecordsExported== " + totalErrorRecordsExported);
                if (totalErrorRecordsExported > 0) {
                    connection = setupSftpConnection();
                    log.debug("Connection established successfully with SFTP server!");

                    var errorFileName = summaryContext.dateCreated + '-ErrorCustomerDeposit.csv';
                    var fileObj = file.create({
                        name: errorFileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

                    connection.upload({
                        directory: '/customerdeposit/error',
                        file: fileObj
                    });

                    log.debug("customer deposit CSV File Uploaded Successfully to SFTP server with file " + errorFileName);
                }
            } catch (e) {
                log.error({
                    title: 'Error in exporting and uploading customer deposit csv files',
                    details: e,
                });
            }
        }
        return { getInputData, map, reduce, summarize }

    });