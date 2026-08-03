/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/file', 'N/record', 'N/runtime', 'N/search', 'N/sftp'],
    (error, file, record, runtime, search, sftp) => {
        const EDITABLE_EVENT_TYPES = ['edit'];

        const pad = (value) => value.toString().padStart(2, '0');

        const formatDate = (value) => {
            if (!value) return null;
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) return null;
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        };

        const loadSftpConfig = () => {
            const sftpSearch = search.create({
                type: 'customrecord_ns_sftp_configuration',
                columns: [
                    'custrecord_ns_sftp_server',
                    'custrecord_ns_sftp_userid',
                    'custrecord_ns_sftp_port_no',
                    'custrecord_ns_sftp_host_key',
                    'custrecord_ns_sftp_guid',
                    'custrecord_ns_sftp_default_file_dir'
                ]
            }).run().getRange({ start: 0, end: 1 });

            if (!sftpSearch || !sftpSearch.length) {
                throw error.create({ name: 'MISSING_SFTP_CONFIG', message: 'NetSuite SFTP configuration not found.' });
            }

            const result = sftpSearch[0];
            return {
                url: result.getValue({ name: 'custrecord_ns_sftp_server' }),
                username: result.getValue({ name: 'custrecord_ns_sftp_userid' }),
                port: parseInt(result.getValue({ name: 'custrecord_ns_sftp_port_no' }), 10),
                hostKey: result.getValue({ name: 'custrecord_ns_sftp_host_key' }),
                secret: result.getValue({ name: 'custrecord_ns_sftp_guid' }),
                directory: result.getValue({ name: 'custrecord_ns_sftp_default_file_dir' }) + 'transferorderv2'
            };
        };

        const buildPayload = (transferOrder) => {
            const itemCount = transferOrder.getLineCount({ sublistId: 'item' });
            const items = [];

            for (let i = 0; i < itemCount; i++) {
                const itemId = transferOrder.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                const quantity = transferOrder.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                const lineId = transferOrder.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });

                if (!itemId || !quantity || !lineId) continue;

                items.push({
                    externalId: lineId.toString(),
                    orderItemTypeId: 'PRODUCT_ORDER_ITEM',
                    productIdType: 'NETSUITE_PRODUCT_ID',
                    productIdValue: itemId.toString(),
                    quantity: parseInt(quantity, 10),
                    statusId: 'ITEM_CREATED',
                    unitListPrice: 0,
                    unitPrice: 0,
                    attributes: [
                        { attrName: 'NetsuiteItemLineId', attrValue: lineId.toString() }
                    ]
                });
            }

            if (!items.length) return null;

            const externalId = transferOrder.id.toString();
            const orderName = transferOrder.getValue({ fieldId: 'tranid' });
            const orderDate = formatDate(transferOrder.getValue({ fieldId: 'trandate' }));

            return {
                externalId: externalId,
                orderName: orderName,
                productStoreId: 'STORE',
                statusId: 'ORDER_CREATED',
                originFacilityExternalId: transferOrder.getValue({ fieldId: 'location' })?.toString(),
                orderTypeId: 'TRANSFER_ORDER',
                orderDate: orderDate,
                statusFlowId: 'TO_Fulfill_And_Receive',
                grandTotal: 0,
                shipGroups: [
                    {
                        shipmentMethodTypeId: 'STANDARD',
                        carrierPartyId: '_NA_',
                        facilityId: transferOrder.getValue({ fieldId: 'location' })?.toString(),
                        orderFacilityExternalId: transferOrder.getValue({ fieldId: 'transferlocation' })?.toString(),
                        items: items
                    }
                ],
                identifications: [
                    { orderIdentificationTypeId: 'NETSUITE_ORDER_ID', idValue: externalId },
                    { orderIdentificationTypeId: 'NETSUITE_ORDER_NAME', idValue: orderName }
                ]
            };
        };

        const afterSubmit = (context) => {
            const eventType = (context.type || '').toString().toLowerCase();
            if (EDITABLE_EVENT_TYPES.indexOf(eventType) === -1) return;

            const transferOrderId = context.newRecord && context.newRecord.id;
            if (!transferOrderId) return;

            const transferOrder = record.load({ type: record.Type.TRANSFER_ORDER, id: transferOrderId });
            const hcOrderId = transferOrder.getValue({ fieldId: 'custbody_hc_order_id' });
            if (!hcOrderId) return;

            const payload = buildPayload(transferOrder);
            if (!payload) return;

            const sftpConfig = loadSftpConfig();
            const connection = sftp.createConnection({
                username: sftpConfig.username,
                secret: sftpConfig.secret,
                url: sftpConfig.url,
                port: sftpConfig.port,
                directory: sftpConfig.directory,
                hostKey: sftpConfig.hostKey
            });

            const fileName = `EditedTransferOrder-${transferOrderId}-${Date.now()}.json`;
            const fileObj = file.create({
                name: fileName,
                fileType: file.Type.JSON,
                contents: JSON.stringify([payload], null, 2),
                encoding: file.Encoding.UTF_8
            });

            if (fileObj.size > connection.MAX_FILE_SIZE) {
                throw error.create({ name: 'FILE_IS_TOO_BIG', message: 'The edited transfer order export file is too big.' });
            }

            connection.upload({
                directory: '/import/transfer-order',
                file: fileObj
            });

            record.submitFields({
                type: record.Type.TRANSFER_ORDER,
                id: transferOrderId,
                values: { custbody_hc_order_exported: true },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        };

        return { afterSubmit };
    });
