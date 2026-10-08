/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/task', 'N/search', 'N/record', 'N/file', 'N/log'], (task, search, record, file, log) => {
  // Body: { messageId, handlerScriptId, fileId }. The handler is a RESTlet whose post takes one line and answers
  // {id, existing} or throws. One HC Batch Run row per message id: a repeat call answers the same task id.
  // Answer: { status: submitted | busy | error, taskId, runId, repeated, message }.
  const RUN = 'customrecord_hc_batch_run';
  const BUSY = ['MAP_REDUCE_ALREADY_RUNNING', 'NO_DEPLOYMENTS_AVAILABLE', 'SSS_MAP_REDUCE_ALREADY_RUNNING'];

  function findRun(messageId) {
    const found = search.create({
      type: RUN,
      filters: [['custrecord_hc_br_message_id', 'is', messageId]],
      columns: ['internalid', 'custrecord_hc_br_task_id', 'custrecord_hc_br_status']
    }).run().getRange({ start: 0, end: 1 });
    if (!found.length) return null;
    return { id: found[0].getValue('internalid'), taskId: found[0].getValue('custrecord_hc_br_task_id'), status: found[0].getValue('custrecord_hc_br_status') };
  }

  function handlerPath(handlerScriptId) {
    const found = search.create({
      type: 'script',
      filters: [['scriptid', 'is', handlerScriptId], 'AND', ['scripttype', 'is', 'RESTLET']],
      columns: ['scriptfile']
    }).run().getRange({ start: 0, end: 1 });
    if (!found.length) return null;
    return file.load({ id: found[0].getValue('scriptfile') }).path;
  }

  function post(body) {
    const messageId = body && body.messageId;
    const handlerScriptId = body && body.handlerScriptId;
    const fileId = body && body.fileId;
    if (!messageId || !handlerScriptId || !fileId) return { status: 'error', message: 'messageId, handlerScriptId and fileId are required' };

    const existing = findRun(messageId);
    if (existing && existing.taskId) return { status: 'submitted', taskId: existing.taskId, runId: existing.id, repeated: true };

    const path = handlerPath(handlerScriptId);
    if (!path) return { status: 'error', message: 'No RESTlet with script id ' + handlerScriptId };

    let runId = existing ? existing.id : null;
    if (!runId) {
      const run = record.create({ type: RUN });
      run.setValue({ fieldId: 'custrecord_hc_br_message_id', value: String(messageId) });
      run.setValue({ fieldId: 'custrecord_hc_br_handler', value: handlerScriptId });
      run.setValue({ fieldId: 'custrecord_hc_br_input_file', value: String(fileId) });
      run.setValue({ fieldId: 'custrecord_hc_br_status', value: 'SUBMITTED' });
      run.setValue({ fieldId: 'custrecord_hc_br_started', value: new Date() });
      runId = run.save();
    }
    try {
      const mrTask = task.create({
        taskType: task.TaskType.MAP_REDUCE,
        scriptId: 'customscript_hc_mr_runbatchfile',
        params: { custscript_hc_batch_file: String(fileId), custscript_hc_batch_handler: path, custscript_hc_batch_run: String(runId) }
      });
      const taskId = mrTask.submit();
      record.submitFields({ type: RUN, id: runId, values: { custrecord_hc_br_task_id: taskId } });
      log.audit({ title: 'BatchRun [ID: ' + runId + ', Message: ' + messageId + ', Task: ' + taskId + '] - Submitted', details: path });
      return { status: 'submitted', taskId: taskId, runId: String(runId) };
    } catch (e) {
      const busy = BUSY.indexOf(e.name) >= 0;
      log.error({ title: 'BatchRun [ID: ' + runId + ', Message: ' + messageId + '] - ' + (busy ? 'Busy' : 'Not submitted'), details: e.name + ': ' + e.message });
      return { status: busy ? 'busy' : 'error', runId: String(runId), message: e.name + ': ' + e.message };
    }
  }
  return { post: post };
});
