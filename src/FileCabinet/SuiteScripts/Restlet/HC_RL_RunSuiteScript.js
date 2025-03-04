/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search', 'N/task'],
    (search, task) => {
        const post = (requestParams) => {            
            var returnMessage = '';
            var scriptName = requestParams.name;
            var scriptType = requestParams.scriptType;
            
            if (scriptType === 'SCHEDULED') {
                // Search for the Script ID using the Script Name
                var scheduledScriptId = search.create({
                    type: search.Type.SCHEDULED_SCRIPT,
                    filters: [['name', 'is', scriptName]],
                    columns: ['scriptid']
                }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                    return result.getValue('scriptid');
                })[0];

                var scheduledDeploymentId = search.create({
                    type: 'scriptdeployment',
                    filters: [['script.scriptid', 'is', scheduledScriptId], 'AND', ['status', 'is', 'NOTSCHEDULED']],
                    columns: ['scriptid']
                }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                    return result.getValue('scriptid');
                })[0];

                if (scheduledScriptId && scheduledDeploymentId) {
                    try {
                        // Create a scheduled script task
                        var scheduledScriptTask = task.create({
                            taskType: task.TaskType.SCHEDULED_SCRIPT,
                            scriptId: scheduledScriptId,
                            deploymentId: scheduledDeploymentId
                        });

                        // Submit the task
                        var taskId = scheduledScriptTask.submit();
                        log.audit('Schedule Script Rescheduled with task ID: ' + taskId);
                        returnMessage = 'Success: Task successfully submitted!';
                    } catch (e) {
                        log.error('Error in Scheduled Script', e.toString());
                        returnMessage = 'Error: ' + e.toString();
                    }
                }
            } 
            if (scriptType === 'MAP_REDUCE') {
                // Search for the Script ID using the Script Name
                var scriptId = search.create({
                    type: search.Type.MAP_REDUCE_SCRIPT,
                    filters: [['name', 'is', scriptName]],
                    columns: ['scriptid']
                }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                    return result.getValue('scriptid');
                })[0];

                var scriptDeploymentId = search.create({
                    type: 'scriptdeployment',
                    filters: [['script.scriptid', 'is', scriptId], 'AND', ['status', 'is', 'NOTSCHEDULED']],
                    columns: ['scriptid']
                }).run().getRange({ start: 0, end: 1 }).map(function (result) {
                    return result.getValue('scriptid');
                })[0];

                if (scriptId && scriptDeploymentId) {
                    try {
                        // Create a scheduled script task
                        var scheduledScriptTask = task.create({
                            taskType: task.TaskType.MAP_REDUCE,
                            scriptId: scriptId,
                            deploymentId: scriptDeploymentId
                        });

                        // Submit the task
                        var taskId = scheduledScriptTask.submit();
                        log.audit('Map/Reduce Script Rescheduled with task ID: ' + taskId);
                        returnMessage = 'Success: Task successfully submitted!';
                    } catch (e) {
                        log.error('Error in Scheduled Script', e.toString());
                        returnMessage = 'Error: ' + e.toString();
                    }
                }
            }
            return JSON.stringify(returnMessage);
        }
        return {post}
    });