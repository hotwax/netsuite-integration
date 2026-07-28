/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {

        const BACKORDER_SEARCH_ID = 'customsearch_hc_pos_digital_order_in_pen';
        const LAST_EXPORT_FIELD = 'custrecord_backorder_var_ex_date';
        const PENDING_WINDOW_FIELD = 'custrecord_backorder_var_pend_date';
        const CSV_HEADER = 'idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments\n';

        // "7/28/2026 5:00:12 am" -> "7/28/2026 5:00 am"
        const toMinutePrecision = (dateTimeString) => {
            var parts = dateTimeString.split(' ');
            var timeWithoutSeconds = parts[1].split(':').slice(0, 2).join(':');
            return parts[0] + ' ' + timeWithoutSeconds + ' ' + parts[2];
        }

        const getLastRuntimeRecord = () => {
            var results = search.create({
                type: 'customrecord_hc_last_runtime_export',
                columns: ['internalid', LAST_EXPORT_FIELD, PENDING_WINDOW_FIELD]
            }).run().getRange({ start: 0, end: 1 });
            return results[0];
        }

        const getInputData = (inputContext) => {
            var lastRuntimeResult = getLastRuntimeRecord();
            if (!lastRuntimeResult) {
                log.error('Missing configuration', 'No customrecord_hc_last_runtime_export record found; skipping backorder variance export.');
                return [];
            }

            var lastExportDate = lastRuntimeResult.getValue({ name: LAST_EXPORT_FIELD });
            if (!lastExportDate) {
                log.error('Missing last export date', 'Seed ' + LAST_EXPORT_FIELD + ' on customrecord_hc_last_runtime_export before enabling this export.');
                return [];
            }

            var now = format.format({ value: new Date(), type: format.Type.DATETIME });
            var windowStart = toMinutePrecision(lastExportDate);
            var windowEnd = toMinutePrecision(now);

            // Persist the window end now; summarize commits it to LAST_EXPORT_FIELD
            // only after a successful upload, so a failed run re-covers this window.
            record.submitFields({
                type: 'customrecord_hc_last_runtime_export',
                id: lastRuntimeResult.getValue({ name: 'internalid' }),
                values: { [PENDING_WINDOW_FIELD]: windowEnd }
            });

            var backorderSearch = search.load({ id: BACKORDER_SEARCH_ID });

            var filters = backorderSearch.filters;
            filters.push(search.createFilter({
                name: 'datecreated',
                operator: search.Operator.WITHIN,
                values: [windowStart, windowEnd]
            }));
            backorderSearch.filters = filters;

            // Override columns so map sees deterministic keys; the line number
            // keeps duplicate item lines on one order distinct. Filters (the
            // search criteria) are untouched, so row multiplicity is unchanged.
            backorderSearch.columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'line' }),
                search.createColumn({ name: 'item' }),
                search.createColumn({ name: 'location' })
            ];

            return backorderSearch;
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var internalId = contextValues.values.internalid.value;
            var lineId = contextValues.values.line;
            var itemSku = contextValues.values.item.text;
            var locationInternalId = contextValues.values.location.value;

            if (!itemSku || !locationInternalId) {
                throw error.create({
                    name: 'MISSING_ROW_DATA',
                    message: 'Missing item or location for SO ' + internalId + ' line ' + lineId
                });
            }

            mapContext.write({
                key: internalId + '-' + lineId,
                value: {
                    'idValue': itemSku,
                    'externalFacilityId': locationInternalId
                }
            });
        }

        const reduce = (reduceContext) => {
            reduceContext.values.forEach((value, index) => {
                var rowData = JSON.parse(value);
                var content = rowData.idValue + ',' + rowData.externalFacilityId + ',SKU,1,,VAR_REPORT,POS clear backorder\n';
                reduceContext.write(reduceContext.key + '-' + index, content);
            });
        }

        const summarize = (summaryContext) => {
            try {
                // Check for stage errors before processing
                if (summaryContext.inputSummary.error) {
                    log.error('Input stage error', summaryContext.inputSummary.error);
                    throw error.create({
                        name: 'INPUT_STAGE_ERROR',
                        message: 'Input stage failed: ' + summaryContext.inputSummary.error
                    });
                }

                var mapErrorCount = 0;
                summaryContext.mapSummary.errors.iterator().each((key, err) => {
                    log.error('Map stage error for key ' + key, err);
                    mapErrorCount = mapErrorCount + 1;
                    return true;
                });

                var reduceErrorCount = 0;
                summaryContext.reduceSummary.errors.iterator().each((key, err) => {
                    log.error('Reduce stage error for key ' + key, err);
                    reduceErrorCount = reduceErrorCount + 1;
                    return true;
                });

                if (mapErrorCount > 0 || reduceErrorCount > 0) {
                    throw error.create({
                        name: 'STAGE_ERRORS',
                        message: 'Map stage had ' + mapErrorCount + ' errors; Reduce stage had ' + reduceErrorCount + ' errors. Skipping upload and window commit.'
                    });
                }

                var fileLines = CSV_HEADER;
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each((key, value) => {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.audit('Backorder variance rows exported', totalRecordsExported);

                if (totalRecordsExported > 0) {
                    var fileName = summaryContext.dateCreated + '-ExportBackorderVariance.csv';
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
                    var sftpSearchResult = customRecordSFTPSearch.run().getRange({
                        start: 0,
                        end: 1
                    })[0];

                    var sftpDirectory = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_default_file_dir'
                    }) + 'inventorytransfer';

                    var connection = sftp.createConnection({
                        username: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_userid' }),
                        secret: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_guid' }),
                        url: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_server' }),
                        port: parseInt(sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_port_no' })),
                        directory: sftpDirectory,
                        hostKey: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_host_key' })
                    });
                    log.debug("Connection established successfully with SFTP server!");

                    if (fileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                            name: "FILE_IS_TOO_BIG",
                            message: "The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/import/',
                        file: fileObj
                    });
                    log.debug("Backorder Variance File Uploaded Successfully to SFTP server with file " + fileName);

                    // Commit the window: the next run starts where this one ended.
                    var lastRuntimeResult = getLastRuntimeRecord();
                    record.submitFields({
                        type: 'customrecord_hc_last_runtime_export',
                        id: lastRuntimeResult.getValue({ name: 'internalid' }),
                        values: {
                            [LAST_EXPORT_FIELD]: lastRuntimeResult.getValue({ name: PENDING_WINDOW_FIELD })
                        }
                    });
                }
            } catch (e) {
                log.error({
                    title: 'Error in exporting and uploading backorder variance csv file',
                    details: e,
                });
                throw error.create({
                    name: "Error in exporting and uploading backorder variance csv file",
                    message: e
                });
            }
        }

        return { getInputData, map, reduce, summarize }
    });
