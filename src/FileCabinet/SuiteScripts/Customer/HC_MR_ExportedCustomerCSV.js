/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {
        const getInputData = (inputContext) => {
            var now = format.format({value : new Date(), type: format.Type.DATETIME});

            var nowDateParts = now.split(' ');

            var datePart = nowDateParts[0];
            var timePart = nowDateParts[1];
            var ampmPart = nowDateParts[2];

            // Remove the seconds from the time part
            var timeWithoutSeconds = timePart.split(':').slice(0, 2).join(':');

            var dateStringWithoutSeconds = datePart + ' ' + timeWithoutSeconds + ' ' + ampmPart;

            // get last customer export runtime
            var customRecordSearch = search.create({
                type: 'customrecord_hc_last_runtime_export',
                columns: ['custrecord_customer_ex_date']
            });

            var searchResults = customRecordSearch.run().getRange({
               start: 0,
               end: 1
            });

            var searchResult = searchResults[0];
            var lastExportDate = searchResult.getValue({
                name: 'custrecord_customer_ex_date'
            });

            var lastExportDateParts = lastExportDate.split(' ');
            var lastExportDatePart = lastExportDateParts[0];
            var lastExportTimePart = lastExportDateParts[1];
            var ampmExportPart = lastExportDateParts[2];

            // Remove the seconds from the time part
            var lastExportTimeWithoutSeconds = lastExportTimePart.split(':').slice(0, 2).join(':');

            var lastExportDateString = lastExportDatePart + ' ' + lastExportTimeWithoutSeconds + ' ' + ampmExportPart;

            // Get customer search query
            var customerSearch = search.load({ id: 'customsearch_hc_export_customer' });
            // Copy the filters from customerSearch into defaultFilters.
            var defaultFilters = customerSearch.filters;

            // Push the customFilters into defaultFilters.

            defaultFilters.push(search.createFilter({
                name: "datecreated",
                operator: search.Operator.WITHIN,
                values: lastExportDateString, dateStringWithoutSeconds
            }));
            // Copy the modified defaultFilters
            customerSearch.filters = defaultFilters;

            return customerSearch;
        }        

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var internalid = contextValues.values.internalid.value;
            var hcCustomerId = contextValues.values.custentity_hc_customer_id;

            var customerdata = {
                'partyId': hcCustomerId,
                'partyIdentificationTypeId': "NETSUITE_CUSTOMER_ID",
                'idValue': internalid
            };
            mapContext.write({
                key: contextValues.id,
                value: customerdata
            });
        }
        
        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var soId = reduceContext.key; 

            var content = contextValues.partyId + ',' + contextValues.partyIdentificationTypeId + ',' + contextValues.idValue + '\n';
            reduceContext.write(soId, content);
        }
        
        const summarize = (summaryContext) => {
            try {
                var fileLines = 'partyId,partyIdentificationTypeId,idValue\n';
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each(function(key, value) {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.debug("====totalRecordsExported=="+totalRecordsExported);
                if (totalRecordsExported > 0) {

                    var fileName =  summaryContext.dateCreated + '-CustomerExport.csv';
                    var customerFileObj = file.create({
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

                    sftpDirectory = sftpDirectory + 'customer';
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
            
                    if (customerFileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                        name:"FILE_IS_TOO_BIG",
                        message:"The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/import/',
                        file: customerFileObj
                    });
                    log.debug("Customer CSV File Uploaded Successfully to SFTP server with file" + fileName);
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

                    // save last sales order export date
                    record.submitFields({
                        type: 'customrecord_hc_last_runtime_export',
                        id: lastRuntimeExportInternalId,
                        values: {
                            custrecord_customer_ex_date : currentDate
                        }
                    });
                }
            } catch (e) {
                log.error({
                title: 'Error in exporting and uploading customer csv files',
                details: e,
                });
                throw error.create({
                name:"Error in exporting and uploading customer csv files",
                message: e
                });
            }            
        }
        return {getInputData, map, reduce, summarize}
    });
