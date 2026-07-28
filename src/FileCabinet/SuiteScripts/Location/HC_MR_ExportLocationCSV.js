/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/task', 'N/error'],
    (file, record, search, sftp, task, error) => {

        const getInputData = () => {
            return search.load({ id: 'customsearch_hc_export_location' });
        }

        const map = (mapContext) => {
            const contextValues = JSON.parse(mapContext.value);
            const values = contextValues.values;
            var internalId = contextValues.id;
          

            log.debug('Processing Location', contextValues);

            const locationData = {
                facilityId: contextValues.id,                        // internal ID
                facilityTypeId: 'RETAIL_STORE',
                externalId: contextValues.id,                       // setting externalId same as internal ID
                facilityName: values.namenohierarchy,              // name field
                phoneNumber: values.phone,
                email: values.custrecord137,                       // custom field for email
                city: values.city,
                state: values.state,
                country: values.country,
                addressLine1: values.address1,
                addressLine2: values.address2,
                latitude: values.latitude,
                longitude: values.longitude,
                zipCode: values.zip
            };

            if(internalId){
              var id = record.submitFields({
                type: record.Type.LOCATION,
                id: internalId,
                values: {
                  custrecord_hc_export_location :true
                }
              })
            }

            log.debug('Location Data', locationData);
            mapContext.write({ key: contextValues.id, value: locationData });
        };


        const reduce = (reduceContext) => {
            var contextValues = JSON.parse(reduceContext.values);
            var locationId = reduceContext.key;
            log.debug('Reducing Location', locationId);
            log.debug('Context Values', contextValues);

            var content = contextValues.facilityId + ',' +
                        contextValues.facilityTypeId + ',' +
                        contextValues.externalId + ',' +
                        contextValues.facilityName + ',' +
                        contextValues.phoneNumber + ',' +
                        contextValues.email + ',' +
                        contextValues.city + ',' +
                        contextValues.state + ',' +
                        contextValues.country + ',' +
                        contextValues.addressLine1 + ',' +
                        contextValues.addressLine2 + ',' +
                        contextValues.latitude + ',' +
                        contextValues.longitude + ',' +
                        contextValues.zipCode + '\n';
            log.debug('CSV Content for Location', content);
            reduceContext.write(locationId, content);
        };

        const summarize = (summaryContext) => {
            try {
                let csvContent = 'facility-id,facility-type-id,external-id,facility-name,phone-number,email,city,state,country,address-line-1,address-line-2,latitude,longitude,zip-code\n';
                let total = 0;

                summaryContext.output.iterator().each((key, value) => {
                    csvContent += value;
                    total++;
                    return true;
                });
                log.debug('Total Locations Processed', total);

                if (total > 0) {
                    const fileName = 'LocationExport-' + summaryContext.dateCreated.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '') + '.csv';

                    const csvFile = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: csvContent
                    });

                    // Load SFTP config from custom record
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
                    });

                    const [config] = sftpSearch.run().getRange({ start: 0, end: 1 });

                    const connection = sftp.createConnection({
                        username: config.getValue('custrecord_ns_sftp_userid'),
                        secret: config.getValue('custrecord_ns_sftp_guid'),
                        url: config.getValue('custrecord_ns_sftp_server'),
                        port: parseInt(config.getValue('custrecord_ns_sftp_port_no')),
                        directory: config.getValue('custrecord_ns_sftp_default_file_dir') + 'location',
                        hostKey: config.getValue('custrecord_ns_sftp_host_key')
                    });

                    if (csvFile.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                            name: "FILE_TOO_LARGE",
                            message: "The file you are trying to upload is too big."
                        });
                    }

                    connection.upload({
                        directory: '/location-nifi/',
                        file: csvFile
                    });

                    log.debug('Location CSV uploaded successfully', fileName);
                }

            } catch (e) {
                log.error('Location Sync Error', e);
                throw error.create({
                    name: 'LOCATION_SYNC_FAILED',
                    message: e.message
                });
            }
        }

        return { getInputData, map, reduce, summarize };
    });
