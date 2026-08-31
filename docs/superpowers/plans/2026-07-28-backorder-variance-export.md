# Backorder Variance Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily NetSuite Map/Reduce script that exports POS digital backorders as the 7-column OMS Inventory Variance CSV and uploads it to the SFTP directory MDM's `IMP_INV_TRANS` already polls.

**Architecture:** Clone of the repo's established export pattern (saved search → map → reduce → CSV in summarize → `N/sftp` upload), with a `datecreated` time window persisted on the `customrecord_hc_last_runtime_export` custom record (committed field + pending field) instead of "exported" flags on Sales Orders. Spec: `docs/superpowers/specs/2026-07-28-backorder-variance-export-design.md`.

**Tech Stack:** SuiteScript 2.1 (Map/Reduce), NetSuite SDF (SuiteCloud project), no test harness — this repo's SuiteScripts are verified by `node --check`/`xmllint` locally and a sandbox runbook (Task 5), matching repo convention.

## Global Constraints

- CSV header, exactly: `idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments`
- Fixed row values: `idType=SKU`, `availableDelta=1`, `locationSeqId=` (empty), `varianceReasonId=VAR_REPORT`, `comments=POS clear backorder`
- `idValue` = item **text** (e.g. `PKG273`), `externalFacilityId` = location **internal id** (e.g. `218`)
- Saved search: `customsearch_hc_pos_digital_order_in_pen` — loaded by id at runtime; its **filters must never be modified in code except appending the date window**; its columns are fully overridden
- SFTP: connection directory = `<custrecord_ns_sftp_default_file_dir>` + `inventorytransfer`, upload directory `/import/`
- The committed timestamp (`custrecord_backorder_var_ex_date`) advances **only after a successful upload**, and only to the value of the pending field written by the same flow
- No writes to Sales Order records, no mark-false recovery task
- All commits go on branch `feat/backorder-variance-export`

---

### Task 1: Custom record fields for the run window

**Files:**
- Modify: `src/Objects/CustomRecord/customrecord_hc_last_runtime_export.xml` (already registered in `src/deploy.xml:94` — no deploy.xml change)

**Interfaces:**
- Produces: field script ids `custrecord_backorder_var_ex_date` (committed window end) and `custrecord_backorder_var_pend_date` (pending window end), both DATETIMETZ. Task 2's script reads/writes exactly these ids.

- [ ] **Step 1: Add the two field definitions**

In `customrecord_hc_last_runtime_export.xml`, inside `<customrecordcustomfields>`, after the last existing `<customrecordcustomfield>` block (`custrecord_to_item_ex_date`, ends line ~88), insert:

```xml
    <customrecordcustomfield scriptid="custrecord_backorder_var_ex_date">
      <accesslevel>2</accesslevel>
      <displaytype>NORMAL</displaytype>
      <fieldtype>DATETIMETZ</fieldtype>
      <label>Backorder Variance Export Date</label>
      <storevalue>T</storevalue>
    </customrecordcustomfield>
    <customrecordcustomfield scriptid="custrecord_backorder_var_pend_date">
      <accesslevel>2</accesslevel>
      <displaytype>NORMAL</displaytype>
      <fieldtype>DATETIMETZ</fieldtype>
      <label>Backorder Variance Pending Window End</label>
      <storevalue>T</storevalue>
    </customrecordcustomfield>
```

- [ ] **Step 2: Validate the XML**

Run: `xmllint --noout src/Objects/CustomRecord/customrecord_hc_last_runtime_export.xml && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/Objects/CustomRecord/customrecord_hc_last_runtime_export.xml
git commit -m "Add backorder variance window fields to last-runtime custom record"
```

---

### Task 2: The Map/Reduce export script

**Files:**
- Create: `src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js`

**Interfaces:**
- Consumes: field ids `custrecord_backorder_var_ex_date`, `custrecord_backorder_var_pend_date` (Task 1); account objects `customsearch_hc_pos_digital_order_in_pen`, `customrecord_hc_last_runtime_export`, `customrecord_ns_sftp_configuration` (all pre-existing in the account).
- Produces: script file referenced by Task 3's object XML as `[/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js]`.

> **Amendment (post-task review):** the shipped file (commit `acdbee5`) additionally
> contains map row-validation (`MISSING_ROW_DATA` thrown when item text or location id
> is missing) and a summarize stage-error guard (`INPUT_STAGE_ERROR`/`STAGE_ERRORS` —
> `inputSummary.error` checked and `mapSummary`/`reduceSummary` errors iterated before
> the CSV is built, so any stage error aborts both the upload and the window commit),
> added during task review. The listing below is left as originally written for
> historical record; the shipped file at
> `src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js`
> is authoritative over this listing.

- [ ] **Step 1: Create the script file with this exact content**

```js
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/file', 'N/record', 'N/search', 'N/sftp', 'N/format', 'N/error'],
    (file, record, search, sftp, format, error) => {

        const BACKORDER_SEARCH_ID = 'customsearch_hc_pos_digital_order_in_pen';
        const LAST_EXPORT_FIELD = 'custrecord_backorder_var_ex_date';
        const PENDING_WINDOW_FIELD = 'custrecord_backorder_var_pend_date';
        const CSV_HEADER = 'idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments\n';

        // "7/28/2026 5:00:12 am" -> "7/28/2026 5:00 am"
        const toMinutePrecision = (dateTimeString) => {
            var parts = dateTimeString.split(' ');
            var timeWithoutSeconds = parts[1].split(':').slice(0, 2).join(':');
            return parts[0] + ' ' + timeWithoutSeconds + ' ' + parts[2];
        }

        const getLastRuntimeRecord = () => {
            var results = search.create({
                type: 'customrecord_hc_last_runtime_export',
                columns: ['internalid', LAST_EXPORT_FIELD, PENDING_WINDOW_FIELD]
            }).run().getRange({ start: 0, end: 1 });
            return results[0];
        }

        const getInputData = (inputContext) => {
            var lastRuntimeResult = getLastRuntimeRecord();
            if (!lastRuntimeResult) {
                log.error('Missing configuration', 'No customrecord_hc_last_runtime_export record found; skipping backorder variance export.');
                return [];
            }

            var lastExportDate = lastRuntimeResult.getValue({ name: LAST_EXPORT_FIELD });
            if (!lastExportDate) {
                log.error('Missing last export date', 'Seed ' + LAST_EXPORT_FIELD + ' on customrecord_hc_last_runtime_export before enabling this export.');
                return [];
            }

            var now = format.format({ value: new Date(), type: format.Type.DATETIME });
            var windowStart = toMinutePrecision(lastExportDate);
            var windowEnd = toMinutePrecision(now);

            // Persist the window end now; summarize commits it to LAST_EXPORT_FIELD
            // only after a successful upload, so a failed run re-covers this window.
            record.submitFields({
                type: 'customrecord_hc_last_runtime_export',
                id: lastRuntimeResult.getValue({ name: 'internalid' }),
                values: { [PENDING_WINDOW_FIELD]: windowEnd }
            });

            var backorderSearch = search.load({ id: BACKORDER_SEARCH_ID });

            var filters = backorderSearch.filters;
            filters.push(search.createFilter({
                name: 'datecreated',
                operator: search.Operator.WITHIN,
                values: [windowStart, windowEnd]
            }));
            backorderSearch.filters = filters;

            // Override columns so map sees deterministic keys; the line number
            // keeps duplicate item lines on one order distinct. Filters (the
            // search criteria) are untouched, so row multiplicity is unchanged.
            backorderSearch.columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'line' }),
                search.createColumn({ name: 'item' }),
                search.createColumn({ name: 'location' })
            ];

            return backorderSearch;
        }

        const map = (mapContext) => {
            var contextValues = JSON.parse(mapContext.value);

            var internalId = contextValues.values.internalid.value;
            var lineId = contextValues.values.line;
            var itemSku = contextValues.values.item.text;
            var locationInternalId = contextValues.values.location.value;

            mapContext.write({
                key: internalId + '-' + lineId,
                value: {
                    'idValue': itemSku,
                    'externalFacilityId': locationInternalId
                }
            });
        }

        const reduce = (reduceContext) => {
            reduceContext.values.forEach((value, index) => {
                var rowData = JSON.parse(value);
                var content = rowData.idValue + ',' + rowData.externalFacilityId + ',SKU,1,,VAR_REPORT,POS clear backorder\n';
                reduceContext.write(reduceContext.key + '-' + index, content);
            });
        }

        const summarize = (summaryContext) => {
            try {
                var fileLines = CSV_HEADER;
                var totalRecordsExported = 0;

                summaryContext.output.iterator().each((key, value) => {
                    fileLines += value;
                    totalRecordsExported = totalRecordsExported + 1;
                    return true;
                });
                log.audit('Backorder variance rows exported', totalRecordsExported);

                if (totalRecordsExported > 0) {
                    var fileName = summaryContext.dateCreated + '-ExportBackorderVariance.csv';
                    var fileObj = file.create({
                        name: fileName,
                        fileType: file.Type.CSV,
                        contents: fileLines
                    });

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
                    var sftpSearchResult = customRecordSFTPSearch.run().getRange({
                        start: 0,
                        end: 1
                    })[0];

                    var sftpDirectory = sftpSearchResult.getValue({
                        name: 'custrecord_ns_sftp_default_file_dir'
                    }) + 'inventorytransfer';

                    var connection = sftp.createConnection({
                        username: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_userid' }),
                        secret: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_guid' }),
                        url: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_server' }),
                        port: parseInt(sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_port_no' })),
                        directory: sftpDirectory,
                        hostKey: sftpSearchResult.getValue({ name: 'custrecord_ns_sftp_host_key' })
                    });
                    log.debug("Connection established successfully with SFTP server!");

                    if (fileObj.size > connection.MAX_FILE_SIZE) {
                        throw error.create({
                            name: "FILE_IS_TOO_BIG",
                            message: "The file you are trying to upload is too big"
                        });
                    }
                    connection.upload({
                        directory: '/import/',
                        file: fileObj
                    });
                    log.debug("Backorder Variance File Uploaded Successfully to SFTP server with file " + fileName);

                    // Commit the window: the next run starts where this one ended.
                    var lastRuntimeResult = getLastRuntimeRecord();
                    record.submitFields({
                        type: 'customrecord_hc_last_runtime_export',
                        id: lastRuntimeResult.getValue({ name: 'internalid' }),
                        values: {
                            [LAST_EXPORT_FIELD]: lastRuntimeResult.getValue({ name: PENDING_WINDOW_FIELD })
                        }
                    });
                }
            } catch (e) {
                log.error({
                    title: 'Error in exporting and uploading backorder variance csv file',
                    details: e,
                });
                throw error.create({
                    name: "Error in exporting and uploading backorder variance csv file",
                    message: e
                });
            }
        }

        return { getInputData, map, reduce, summarize }
    });
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Sanity-check the CSV constants against the spec**

Run: `grep -c "idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments" src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js`
Expected: `1`
Run: `grep -c "SKU,1,,VAR_REPORT,POS clear backorder" src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js
git commit -m "Add backorder variance export Map/Reduce script"
```

---

### Task 3: Script + deployment object XML

**Files:**
- Create: `src/Objects/InventoryVariance/customscript_exp_backorder_variance.xml`

**Interfaces:**
- Consumes: script file path from Task 2.
- Produces: object ids `customscript_exp_backorder_variance` / `customdeploy_exp_backorder_variance`, registered in deploy.xml by Task 4 and referenced in the Task 5 runbook.

- [ ] **Step 1: Create the object file with this exact content**

(Modeled on `src/Objects/InventoryAdjustment/customscript_exp_inventory_adj.xml`; single daily 05:00 UTC run, no intraday `<repeat>`.)

```xml
<mapreducescript scriptid="customscript_exp_backorder_variance">
  <description>Exports POS digital backorders as OMS inventory variance CSV (IMP_INV_TRANS) to the SFTP import directory.</description>
  <isinactive>F</isinactive>
  <name>HC_MR_ExportBackorderVarianceCSV</name>
  <notifyadmins>F</notifyadmins>
  <notifyemails></notifyemails>
  <notifyowner>T</notifyowner>
  <scriptfile>[/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js]</scriptfile>
  <scriptdeployments>
    <scriptdeployment scriptid="customdeploy_exp_backorder_variance">
      <buffersize>1</buffersize>
      <concurrencylimit>1</concurrencylimit>
      <isdeployed>T</isdeployed>
      <loglevel>DEBUG</loglevel>
      <queueallstagesatonce>T</queueallstagesatonce>
      <status>SCHEDULED</status>
      <title>HC_MR_ExportBackorderVarianceCSV</title>
      <yieldaftermins>60</yieldaftermins>
      <recurrence>
        <daily>
          <everyxdays>1</everyxdays>
          <startdate>2026-07-28</startdate>
          <starttime>05:00:00Z</starttime>
        </daily>
      </recurrence>
    </scriptdeployment>
  </scriptdeployments>
</mapreducescript>
```

- [ ] **Step 2: Validate the XML**

Run: `xmllint --noout src/Objects/InventoryVariance/customscript_exp_backorder_variance.xml && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/Objects/InventoryVariance/customscript_exp_backorder_variance.xml
git commit -m "Add script object and daily deployment for backorder variance export"
```

---

### Task 4: Register file and object in deploy.xml

**Files:**
- Modify: `src/deploy.xml`

**Interfaces:**
- Consumes: paths from Tasks 2 and 3.

- [ ] **Step 1: Add the script file path**

In `src/deploy.xml`, in the `<files>` section, after the line
`<path>~/FileCabinet/SuiteScripts/InventoryAdjustment/HC_MR_ExportedInventoryAdjustmentCSV.js</path>`, add:

```xml
        <path>~/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js</path>
```

- [ ] **Step 2: Add the object path**

In the `<objects>` section, after the line
`<path>~/Objects/InventoryAdjustment/customscript_exp_inventory_adj.xml</path>`, add:

```xml
        <path>~/Objects/InventoryVariance/customscript_exp_backorder_variance.xml</path>
```

- [ ] **Step 3: Validate and verify both entries exist**

Run: `xmllint --noout src/deploy.xml && grep -c "InventoryVariance" src/deploy.xml`
Expected: `2`

- [ ] **Step 4: Commit**

```bash
git add src/deploy.xml
git commit -m "Register backorder variance export in deploy manifest"
```

---

### Task 5: Sandbox deployment + verification runbook

No repo files change in this task — it is executed against the NetSuite sandbox account and requires account credentials (SDF auth is not configured on this machine: `suitecloud` CLI absent, `project.json` `defaultAuthId` empty). Record results as a comment on the PR or in the deploy notes.

- [ ] **Step 1: One-time tooling/auth setup (if not already done)**

```bash
npm install -g @oracle/suitecloud-cli
cd plugins/netsuite-integration
suitecloud account:setup   # interactive; select the SANDBOX account, save authid
```

- [ ] **Step 2: Validate and deploy the project to sandbox**

```bash
suitecloud project:validate
suitecloud project:deploy
```
Expected: validation passes; deploy reports the new file, script object, and updated custom record.

- [ ] **Step 3: Seed the committed timestamp**

In NetSuite UI: Customization → Lists/Records → Record Types → *HC Last Runtime Export* → open the (single) record → set **Backorder Variance Export Date** to the datetime of the last manual variance import (or "now" if backlog was just cleared manually). Leave the Pending field empty.
This is required: the script deliberately no-ops with an error log if the field is empty, to prevent an unbounded first-run export double-counting a manual import.

- [ ] **Step 4: First run — verify file content**

NetSuite UI: Customization → Scripting → Script Deployments → `customdeploy_exp_backorder_variance` → Save & Execute.
Verify in the script's execution log: `Backorder variance rows exported` count matches the saved search's row count for the window.
Fetch the file from `/home/gorjana-oms-sftp/netsuite/inventorytransfer/import/` and check:
- header is exactly `idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments`
- a spot-checked row reads like `PKG273,218,SKU,1,,VAR_REPORT,POS clear backorder`
- an order with duplicate item lines (like the 3× GC-50 example) produces one row per line

- [ ] **Step 5: Second run — verify no duplicates**

Trigger the deployment again immediately. Expected: execution log shows `Backorder variance rows exported: 0` (or only orders created in between), and no file with previously-exported rows appears on the SFTP server.

- [ ] **Step 6: Confirm MDM ingestion**

In OMS MDM (`/commerce/control/ImportData?configId=IMP_INV_TRANS` config's poller), confirm the uploaded file was picked up and processed, and the corresponding backorders become fulfillable.

**Note:** a permanently bad row (genuinely empty item/location) makes every run fail loudly and blocks the window until the data or search is fixed — this is deliberate (no silent loss). The unblocking step is fixing the offending order line data (or search criteria), not clearing the timestamp.
