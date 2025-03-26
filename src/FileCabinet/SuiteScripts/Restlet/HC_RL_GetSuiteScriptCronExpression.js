/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search'],
    ( record, search) => {
        const get = (context) => {
            var scriptName = context.jobName;
            var recurrenceMinutes = null;

            var scriptDeploymentInternalId = search.create({
                type: 'scriptdeployment',
                filters: [['title', 'is', scriptName], 'AND', ['status', 'noneof', 'NOTSCHEDULED']],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                return result.getValue('internalid');
            })[0];

            if (scriptDeploymentInternalId) {
                var scriptDeployment = record.load({
                    type: 'scriptdeployment',
                    id: scriptDeploymentInternalId
                });

                var recurringevent = scriptDeployment.getValue({
                    fieldId: 'recurringevent'
                }); 
                if (recurringevent) {
                    var recurringeventStr = JSON.parse(recurringevent);
                    recurrenceMinutes = recurringeventStr.repeatTimeInMinutes;
                }
            }
            return JSON.stringify({
                status: 'success',
                message: 'Cron Expression sent',
                recurrenceMinutes: recurrenceMinutes
            }); 
        }
        return {get}
    });
