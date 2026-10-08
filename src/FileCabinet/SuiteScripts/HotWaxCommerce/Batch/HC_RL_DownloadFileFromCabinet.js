/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file', 'N/log'], (file, log) => {
  // GET ?fileId=. Answers the file's contents as text; a batch result file is one JSON line per record.
  // A missing or unreadable id answers JSON text { status: 'error', message }.
  function get(params) {
    const fileId = params && params.fileId;
    if (!fileId) return JSON.stringify({ status: 'error', message: 'fileId is required' });
    try {
      return file.load({ id: fileId }).getContents();
    } catch (e) {
      log.error({ title: 'File [ID: ' + fileId + '] - Not read', details: e.name + ': ' + e.message });
      return JSON.stringify({ status: 'error', fileId: String(fileId), message: e.name + ': ' + e.message });
    }
  }
  return { get: get };
});
