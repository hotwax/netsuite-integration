/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search'],
    ( record, search) => {
        const post = (requestBody) => {
            var scriptName = requestBody.jobName;
            var paused = requestBody.paused;

            var scriptInternalId = search.create({
                type: 'scriptdeployment',
                filters: [['title', 'is', scriptName], 'AND', ['status', 'noneof', 'NOTSCHEDULED']],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                return result.getValue('internalid');
            })[0];

            if (scriptInternalId && paused) {
                if (paused === 'Y') {
                    record.submitFields({
                        type: record.Type.SCRIPT_DEPLOYMENT,
                        id: scriptInternalId,
                        values: {
                            status: 'TESTING'
                        }
                    }); 
                } 
                if (paused === 'N') {
                    record.submitFields({
                        type: record.Type.SCRIPT_DEPLOYMENT,
                        id: scriptInternalId,
                        values: {
                            status: 'SCHEDULED'
                        }
                    }); 
                }

            }
            return {
                status: 'success',
                message: 'Successfully updated the status.',
                requestBody: requestBody
            };
        }
        return {post}
    });
