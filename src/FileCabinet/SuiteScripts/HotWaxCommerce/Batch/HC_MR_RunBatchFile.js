/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/runtime', 'N/file', 'N/compress', 'N/record', 'N/log'], (runtime, file, compress, record, log) => {
  // Calls a handler RESTlet's post once per line of a File Cabinet file, NDJSON, and writes the answers.
  // Parameters: custscript_hc_batch_file, the input file id; custscript_hc_batch_handler, the RESTlet's file path;
  // custscript_hc_batch_run, the HC Batch Run row. The handler answers {id, existing} or throws an error with a name.
  // Result: <fileId>-result.txt beside the input, one line per input line:
  //   {"externalId", "netsuiteId", "existing"} or {"externalId", "errorMessage"}.
  const RUN = 'customrecord_hc_batch_run';

  function param(name) {
    return runtime.getCurrentScript().getParameter({ name: name });
  }

  // Server scripts load a module named at run time through the callback form of require, which runs at once.
  function loadHandler(path) {
    let handler = null;
    require([path], (loaded) => { handler = loaded; });
    if (!handler || typeof handler.post !== 'function') throw new Error('Handler ' + path + ' did not load or has no post');
    return handler;
  }

  function getInputData() {
    const input = file.load({ id: param('custscript_hc_batch_file') });
    return input.name.endsWith('.gz') ? compress.gunzip({ file: input }) : input;
  }

  function map(context) {
    let item = null;
    try {
      item = JSON.parse(context.value);
      const answer = loadHandler(param('custscript_hc_batch_handler')).post(item);
      context.write({ key: String(item.externalId), value: JSON.stringify({ externalId: item.externalId, netsuiteId: String(answer.id), existing: answer.existing === true }) });
    } catch (e) {
      const externalId = item && item.externalId ? String(item.externalId) : 'line ' + context.key;
      log.error({ title: 'BatchFile [External ID: ' + externalId + '] - Refused', details: e.name + ': ' + e.message });
      context.write({ key: externalId, value: JSON.stringify({ externalId: externalId, errorMessage: e.name + ': ' + e.message }) });
    }
  }

  function summarize(summary) {
    const fileId = param('custscript_hc_batch_file');
    const runId = param('custscript_hc_batch_run');
    const lines = [];
    let created = 0;
    let refused = 0;
    summary.output.iterator().each((key, value) => {
      lines.push(value);
      if (JSON.parse(value).errorMessage) refused++; else created++;
      return true;
    });
    summary.mapSummary.errors.iterator().each((key, error) => {
      lines.push(JSON.stringify({ externalId: key, errorMessage: JSON.parse(error).message }));
      refused++;
      return true;
    });
    const values = { custrecord_hc_br_lines: lines.length, custrecord_hc_br_created: created, custrecord_hc_br_refused: refused, custrecord_hc_br_finished: new Date() };
    if (summary.inputSummary.error) {
      values.custrecord_hc_br_status = 'FAILED';
      values.custrecord_hc_br_error = String(summary.inputSummary.error);
      log.error({ title: 'BatchFile [File: ' + fileId + ', Run: ' + runId + '] - Input not read', details: summary.inputSummary.error });
    } else {
      const input = file.load({ id: fileId });
      const result = file.create({
        name: fileId + '-result.txt',
        fileType: file.Type.PLAINTEXT,
        contents: lines.join('\n') + (lines.length ? '\n' : ''),
        folder: input.folder
      });
      values.custrecord_hc_br_result_file = String(result.save());
      values.custrecord_hc_br_status = 'COMPLETE';
    }
    if (runId) record.submitFields({ type: RUN, id: runId, values: values });
    log.audit({ title: 'BatchFile [File: ' + fileId + ', Run: ' + runId + ', Lines: ' + lines.length + ', Created: ' + created + ', Refused: ' + refused + '] - ' + values.custrecord_hc_br_status, details: '' });
  }

  return { getInputData: getInputData, map: map, summarize: summarize };
});
