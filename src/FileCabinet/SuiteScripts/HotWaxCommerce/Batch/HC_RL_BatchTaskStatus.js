/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/task', 'N/search', 'N/log'], (task, search, log) => {
  // GET ?messageId=. Answer, as JSON text since a GET without a JSON body must return text: the HC Batch Run row
  // and the task's live status and stage while it runs. The result lines are read from resultFileId through
  // HC_RL_DownloadFileFromCabinet once the status is COMPLETE.
  // { messageId, runId, status: SUBMITTED | PROCESSING | COMPLETE | FAILED, stage, taskId, inputFileId, resultFileId,
  //   lines, created, refused, error }.
  const RUN = 'customrecord_hc_batch_run';
  const COLUMNS = ['internalid', 'custrecord_hc_br_status', 'custrecord_hc_br_task_id', 'custrecord_hc_br_input_file',
    'custrecord_hc_br_result_file', 'custrecord_hc_br_lines', 'custrecord_hc_br_created', 'custrecord_hc_br_refused', 'custrecord_hc_br_error'];

  function get(params) {
    const messageId = params && params.messageId;
    if (!messageId) return JSON.stringify({ status: 'error', message: 'messageId is required' });
    const found = search.create({ type: RUN, filters: [['custrecord_hc_br_message_id', 'is', messageId]], columns: COLUMNS })
      .run().getRange({ start: 0, end: 1 });
    if (!found.length) return JSON.stringify({ messageId: messageId, status: 'error', message: 'No batch run for message ' + messageId });
    const run = found[0];
    const answer = {
      messageId: messageId, runId: run.getValue('internalid'), status: run.getValue('custrecord_hc_br_status'),
      taskId: run.getValue('custrecord_hc_br_task_id'), inputFileId: run.getValue('custrecord_hc_br_input_file'),
      resultFileId: run.getValue('custrecord_hc_br_result_file') || null,
      lines: Number(run.getValue('custrecord_hc_br_lines') || 0), created: Number(run.getValue('custrecord_hc_br_created') || 0),
      refused: Number(run.getValue('custrecord_hc_br_refused') || 0), error: run.getValue('custrecord_hc_br_error') || null
    };
    if (answer.status === 'SUBMITTED' && answer.taskId) {
      try {
        const live = task.checkStatus({ taskId: answer.taskId });
        answer.stage = live.stage;
        if (live.status === task.TaskStatus.FAILED) answer.status = 'FAILED';
        else if (live.status === task.TaskStatus.PROCESSING) answer.status = 'PROCESSING';
      } catch (e) {
        log.error({ title: 'BatchRun [ID: ' + answer.runId + ', Task: ' + answer.taskId + '] - Status not read', details: e.name + ': ' + e.message });
        answer.taskError = e.name + ': ' + e.message;
      }
    }
    return JSON.stringify(answer);
  }
  return { get: get };
});
