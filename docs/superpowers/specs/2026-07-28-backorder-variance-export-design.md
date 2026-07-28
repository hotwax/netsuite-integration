# Automated Backorder Variance Export (NetSuite → OMS)

**Date:** 2026-07-28
**Status:** Approved

## Problem

Before month-end reconciliation, POS digital-item backorders (gift cards, packaging
items sold through store POS that stores cannot fulfill) must be cleared so orders can
be fulfilled and invoiced in OMS. Today this is manual: a user exports NetSuite saved
search `customsearch_hc_pos_digital_order_in_pen` ("HC Export Backordered POS",
internal id 6872) to CSV, hand-converts it to the OMS Inventory Variance Import format,
and uploads it through the MDM `ImportData` UI (`configId=IMP_INV_TRANS`).

This flow becomes fully automated: a scheduled NetSuite script produces the exact
7-column variance CSV and drops it on the SFTP path that `IMP_INV_TRANS` already polls.

## Solution overview

One new Map/Reduce SuiteScript, cloned from the repo's established export pattern
(`HC_MR_ExportedInventoryAdjustmentCSV.js` / `HC_MR_ExportedInventoryTransferCSV.js`):

| Piece | Value |
|---|---|
| Script file | `src/FileCabinet/SuiteScripts/InventoryVariance/HC_MR_ExportBackorderVarianceCSV.js` |
| Script object | `customscript_exp_backorder_variance` (+ deployment `customdeploy_exp_backorder_variance`) |
| Schedule | Daily, 05:00 UTC (single run, no intraday repeat) |
| Input search | `customsearch_hc_pos_digital_order_in_pen`, loaded by script id at runtime; result columns overridden by the script (see below) |
| Run-state | New `custrecord_backorder_var_ex_date` + `custrecord_backorder_var_pend_date` (DATETIMETZ) fields on `customrecord_hc_last_runtime_export` |
| Output | CSV uploaded to SFTP `<base>/inventorytransfer` + `/import/` → `/home/gorjana-oms-sftp/netsuite/inventorytransfer/import` |
| OMS side | No changes — `IMP_INV_TRANS` already polls that directory |

## Input: saved search + time window

- The search returns **one row per backordered unit** (line-level rows on POS digital
  orders; lines are always quantity 1).
- The script loads the search by script id (`suitecloud` CLI/auth is not configured
  locally, so the search is not versioned in-project for now — optional follow-up) and
  **overrides its result columns** with a known set: `internalid`, `line`, `item`,
  `location`. This gives `map` deterministic JSON keys regardless of the search's
  display columns, and the `line` number keeps duplicate item rows on one order (e.g.
  three GC-50 lines on SO 77388419) distinct. Filters — the search's criteria — are
  untouched, so row multiplicity is unchanged.
- `getInputData`:
  1. Reads `custrecord_backorder_var_ex_date` (last successful run's window end).
     If empty or the record is missing, logs an error and returns `[]` — the field
     must be seeded during deployment (see Verification).
  2. Computes `windowEnd = now`, formatted to minute precision with `N/format`, same
     idiom as the other export scripts, and writes it to
     `custrecord_backorder_var_pend_date` (the "pending" bound).
  3. Loads the saved search and appends a filter
     `datecreated WITHIN [lastRun, windowEnd]` — using the correct array form
     `values: [lastRun, windowEnd]` (note: `HC_MR_ExportedPOSReturnCSV.js:130` has a
     latent bug here, passing only one value via object-shorthand; ours must not copy it).
- Windowing on **`datecreated`** (immutable) makes the no-flag approach safe: each
  order enters the window exactly once. Orders fulfilled before the run drop out via
  the search's own pending-status criteria; no Sales Order fields are written.
- Map/Reduce stages are separate script executions, so `summarize` cannot see
  `getInputData` locals. The pending-field write is how the **exact filter bound**
  reaches `summarize`: on successful upload it copies
  `custrecord_backorder_var_pend_date` into `custrecord_backorder_var_ex_date`.
  Recomputing "now" in summarize would permanently skip orders created while the
  script runs; a failed run simply leaves the committed bound alone.

## Map / Reduce

- `map`: for each search row, emit key `internalid + '-' + line`, value
  `{ idValue: <item text>, externalFacilityId: <location internal id> }`.
  `idValue` uses the item's **text** (e.g. `PKG273`), not the internal id.
- `reduce`: for each value, write the CSV line
  `<idValue>,<externalFacilityId>,SKU,1,,VAR_REPORT,POS clear backorder`
  — `summarize` concatenates the lines under the fixed header.

## Output CSV

Header (exact, 7 columns):

```
idValue,externalFacilityId,idType,availableDelta,locationSeqId,varianceReasonId,comments
```

Row values: first two from the search; trailing five fixed defaults —
`idType=SKU`, `availableDelta=1`, `locationSeqId=` (empty), `varianceReasonId=VAR_REPORT`,
`comments=POS clear backorder`. One CSV row per search row, **no dedup** (each row is
one unit of variance). Filename: `<summaryContext.dateCreated>-ExportBackorderVariance.csv`.

## Delivery

SFTP connection built from the `customrecord_ns_sftp_configuration` custom record
(server, user, port, host key, GUID secret, base directory). Connection directory =
`<base dir>` + `inventorytransfer`; upload directory `/import/`. File lands at
`/home/gorjana-oms-sftp/netsuite/inventorytransfer/import`, polled by MDM
`IMP_INV_TRANS`.

## Error handling

- Any failure in `summarize` (SFTP connect, oversize file, upload): log and throw
  **without** updating `custrecord_backorder_var_ex_date`. The next run re-covers the
  same window — no lost backorders, no duplicates (nothing was uploaded).
- Timestamp advances **only after successful upload**, to the `windowEnd` used in the
  filter.
- Zero search results: no file created, timestamp not advanced. Harmless — the next
  run's window covers the same span plus the new day.
- No `mark-false` recovery task and no failed-record CSV: the no-flag design writes
  nothing to Sales Orders, so there is nothing to roll back.
- `summarize` checks `inputSummary.error` and iterates `mapSummary`/`reduceSummary`
  errors **before** building/uploading the CSV; any stage error throws
  (`INPUT_STAGE_ERROR`/`STAGE_ERRORS`) and aborts both the upload and the window
  commit, so partial failures (e.g. one bad row) never advance the window.
- Narrow case: upload succeeds but the post-upload `submitFields` commit fails. The
  file was delivered to SFTP, but `custrecord_backorder_var_ex_date` was not advanced,
  so the next run re-exports the same rows (duplicate CSV, not duplicate NetSuite
  data). Manual recovery: copy the pending field's value
  (`custrecord_backorder_var_pend_date`) into the committed field
  (`custrecord_backorder_var_ex_date`) before the next run.

## Accepted edge cases

1. **Minute-boundary rows.** `WITHIN` is inclusive at both ends at minute precision;
   an order created in the exact boundary minute can export twice or, in a rare
   interleaving, be missed. Same exposure as the nine existing time-window exports.
2. **Quantity > 1 lines** would still emit `availableDelta=1`. Confirmed acceptable:
   POS digital lines are always quantity 1.
3. **Created-then-fulfilled between runs**: order never exports. Correct — it no
   longer needs a variance.

## Verification

1. Deploy to sandbox; seed `custrecord_backorder_var_ex_date`.
2. Trigger the deployment; confirm the file's header and rows against live search
   results (spot-check an order with duplicate item lines).
3. Confirm the file arrives in `/home/gorjana-oms-sftp/netsuite/inventorytransfer/import`
   and MDM `IMP_INV_TRANS` ingests it.
4. Trigger a second run immediately; confirm no duplicate rows are exported.

## Out of scope

- Fixing the `WITHIN`-values bug in `HC_MR_ExportedPOSReturnCSV.js` (separate flow).
- Any OMS/MDM configuration changes.
- Retiring the manual month-end process (business decision once the daily flow is trusted).
