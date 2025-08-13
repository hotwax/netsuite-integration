/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/sftp', 'N/search', 'N/file', 'N/log', 'N/error'], function (sftp, search, file, log, error) {
  function execute(context) {
    try {
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

      sftpDirectory = sftpDirectory + 'product';
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

      var list = connection.list({
        path: '/placeholder-product/',
        sort: sftp.Sort.DATE
      });

      for (var i = 0; i < list.length; i++) {
        if (!list[i].directory) {
          var fileName = list[i].name;

          try {
            var downloadedFile = connection.download({
              directory: '/placeholder-product',
              filename: fileName
            });
            log.debug('Downloaded file: ' + fileName);

            if (downloadedFile && downloadedFile.size > 0) {
              var contents = downloadedFile.getContents();
              var lines = contents.split('\n').filter(line => line.trim() !== '');
              var validRecords = ['id-value,good-identification-value'];
              var missingRecords = ['id-value,good-identification-value'];

              for (var j = 1; j < lines.length; j++) {
                var cols = lines[j].split(',');
                var internalName = cols[1] && cols[1].trim();

                if (!internalName) continue;

                var netsuiteInternalId = search.create({
                  type: 'customrecord_celigo_shopify_shpfitem_map',
                  filters: [['custrecord_celigo_shpf_siim_variantid', 'is', internalName]],
                  columns: ['custrecord_celigo_shpf_siim_nsid']
                })
                  .run()
                  .getRange({ start: 0, end: 1 })
                  .map(function (result) {
                    return result.getValue('custrecord_celigo_shpf_siim_nsid');
                  })[0];

                if (netsuiteInternalId) {
                  var itemId = search.lookupFields({
                    type: search.Type.ITEM,
                    id: netsuiteInternalId,
                    columns: ['itemid']
                  }).itemid;

                  validRecords.push(`${itemId},${netsuiteInternalId}`);
                } else {
                  missingRecords.push(`${internalName},`);
                }
              }

              if (validRecords.length > 1) {
                var validFile = file.create({
                  name: fileName,
                  fileType: file.Type.CSV,
                  contents: validRecords.join('\n')
                });
                connection.upload({
                  directory: '/csv/',
                  file: validFile
                });
                log.debug("Valid records uploaded: /csv/" + fileName);
              }

              if (missingRecords.length > 1) {
                var missingFile = file.create({
                  name: 'missing_' + fileName,
                  fileType: file.Type.CSV,
                  contents: missingRecords.join('\n')
                });
                connection.upload({
                  directory: '/placeholder-product/required_fields_missing/',
                  file: missingFile
                });
                log.debug("Missing records uploaded: /placeholder-product/required_fields_missing/missing_" + fileName);
              }
            }
            // Archive the file
            connection.move({
              from: '/placeholder-product/' + fileName,
              to: '/placeholder-product/archive/' + fileName
            });
            log.debug('File moved!' + fileName);

          } catch (e) {
            log.error('Error processing file: ' + fileName, e.message);
            var errorFile = file.create({
              name: 'error_' + fileName,
              fileType: file.Type.CSV,
              contents: `Error processing ${fileName}:\n${e.message}`
            });
            connection.upload({
              directory: '/placeholder-product/error/',
              file: errorFile
            });
          }
        }
      }

    } catch (e) {
      log.error({
        title: 'Scheduled Script Failure',
        details: e
      });
      throw error.create({
        name: "SCHEDULED_SCRIPT_FAILURE",
        message: e.message
      });
    }
  }

  return {
    execute: execute
  };
});


