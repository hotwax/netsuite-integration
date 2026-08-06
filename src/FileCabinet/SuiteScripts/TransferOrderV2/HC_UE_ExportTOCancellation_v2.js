/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/file', 'N/search', 'N/sftp'],
    (error, file, search, sftp) => {
        const SUPPORTED_EVENT_TYPES = ['edit'];
        const EXPORT_DIRECTORY = '/cancel';

        function afterSubmit(context) {
            try {
                const eventType = String(context.type || '').toLowerCase();
                if (SUPPORTED_EVENT_TYPES.indexOf(eventType) === -1) return;

                const newRecord = context.newRecord;
                const oldRecord = context.oldRecord;
                if (!newRecord || !oldRecord) return;

                const closedLines = getNewlyClosedLines(newRecord, oldRecord);
                if (!closedLines.length) return;

                const orderName = newRecord.getValue({ fieldId: 'tranid' });
                if (!orderName) {
                    throw error.create({
                        name: 'MISSING_TRANSFER_ORDER_NAME',
                        message: 'Unable to export transfer order cancellation because tranid is blank.'
                    });
                }

                const csvContents = buildCancellationCsv(orderName, closedLines);
                const exportFile = file.create({
                    name: getFileName(orderName),
                    fileType: file.Type.CSV,
                    contents: csvContents,
                    encoding: file.Encoding.UTF_8
                });

                const connection = getSftpConnection();
                connection.upload({
                    directory: EXPORT_DIRECTORY,
                    file: exportFile
                });

                log.audit({
                    title: 'Exported transfer order cancellation',
                    details: {
                        orderId: newRecord.id,
                        orderName: orderName,
                        lineIds: closedLines
                    }
                });
            } catch (e) {
                log.error({
                    title: 'Error exporting transfer order cancellation',
                    details: e
                });
                throw e;
            }
        }

        function getNewlyClosedLines(newRecord, oldRecord) {
            const oldLineStatusMap = {};
            const oldLineCount = oldRecord.getLineCount({ sublistId: 'item' }) || 0;
            for (let index = 0; index < oldLineCount; index++) {
                const lineId = getLineId(oldRecord, index);
                if (!lineId) continue;
                oldLineStatusMap[String(lineId)] = isLineClosed(oldRecord, index);
            }

            const newlyClosedLines = [];
            const newLineCount = newRecord.getLineCount({ sublistId: 'item' }) || 0;
            for (let index = 0; index < newLineCount; index++) {
                const lineId = getLineId(newRecord, index);
                if (!lineId) continue;

                const newClosed = isLineClosed(newRecord, index);
                const oldClosed = oldLineStatusMap[String(lineId)] === true;
                if (newClosed && !oldClosed) newlyClosedLines.push(String(lineId));
            }

            return newlyClosedLines;
        }

        function getLineId(orderRecord, line) {
            return orderRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'line',
                line: line
            });
        }

        function isLineClosed(orderRecord, line) {
            return orderRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'isclosed',
                line: line
            }) === true;
        }

        function buildCancellationCsv(orderName, lineIds) {
            const rows = ['orderName,lineId,closed'];
            lineIds.forEach((lineId) => {
                rows.push([escapeCsv(orderName), escapeCsv(lineId), 'true'].join(','));
            });
            return rows.join('\n');
        }

        function escapeCsv(value) {
            const stringValue = String(value == null ? '' : value);
            if (/[",\n]/.test(stringValue)) {
                return '"' + stringValue.replace(/"/g, '""') + '"';
            }
            return stringValue;
        }

        function getFileName(orderName) {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
            return 'TransferOrderCancellation-' + orderName + '-' + timestamp + '.csv';
        }

        function getSftpConnection() {
            const sftpConfig = search.create({
                type: 'customrecord_ns_sftp_configuration',
                columns: [
                    'custrecord_ns_sftp_server',
                    'custrecord_ns_sftp_userid',
                    'custrecord_ns_sftp_port_no',
                    'custrecord_ns_sftp_host_key',
                    'custrecord_ns_sftp_guid',
                    'custrecord_ns_sftp_default_file_dir'
                ]
            }).run().getRange({ start: 0, end: 1 })[0];

            if (!sftpConfig) {
                throw error.create({
                    name: 'MISSING_SFTP_CONFIGURATION',
                    message: 'No NetSuite SFTP configuration record found.'
                });
            }

            const directory = String(sftpConfig.getValue({ name: 'custrecord_ns_sftp_default_file_dir' }) || '') + 'transferorderv2/export';
            return sftp.createConnection({
                username: sftpConfig.getValue({ name: 'custrecord_ns_sftp_userid' }),
                secret: sftpConfig.getValue({ name: 'custrecord_ns_sftp_guid' }),
                url: sftpConfig.getValue({ name: 'custrecord_ns_sftp_server' }),
                port: parseInt(sftpConfig.getValue({ name: 'custrecord_ns_sftp_port_no' }), 10),
                directory: directory,
                hostKey: sftpConfig.getValue({ name: 'custrecord_ns_sftp_host_key' })
            });
        }

        return { afterSubmit: afterSubmit };
    });
