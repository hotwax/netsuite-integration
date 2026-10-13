# Making a credit memo from an RMA with a RESTlet

## Purpose

`HC_RL_CreateCreditMemoFromRma` transforms a NetSuite Return Authorization into a Credit Memo. It can be called directly or used as the handler for the shared File Cabinet batch framework.

The script is idempotent by `externalId`: when a Credit Memo with the same external ID already exists, the existing transaction is returned instead of creating a duplicate.

## Request

Required fields:

| Field | Description |
|---|---|
| `rmaId` | Internal ID of the Return Authorization |
| `externalId` | Stable external ID used for idempotency |
| `tranDate` | Transaction date in `YYYY-MM-DD` format |
| `locationId` | NetSuite location used on the Credit Memo and its item lines |

Minimal example:

```json
{
  "rmaId": "12345",
  "externalId": "HC-CM-10001",
  "tranDate": "2026-10-13",
  "locationId": "7"
}
```

Optional fields:

- `departmentId`: sets the department on the transaction and item lines.
- `memo`: transaction memo.
- `customFields`: object containing body field IDs and values.
- `closeLines`: array of `custcol_hc_order_line_id` values to close on the RMA before transformation.
- `disableTaxCalculation`: controls `custbody_ava_disable_tax_calculation`; it defaults to `true`.
- `overrideItems`: replaces the transformed RMA lines with explicitly supplied financial lines.
- `adjustments`: adds settlement or adjustment lines after the returned merchandise.
- `balanceTo`: adds a tax-variance line when required to bring the Credit Memo to a requested total.

Every `adjustments` or `overrideItems` entry requires `itemId`, `rate`, and `taxCodeId`. When `balanceTo` is provided, it requires `total`, `taxVarianceItemId`, and `taxCodeId`.

## Processing

1. Validate the request.
2. Search for an existing Credit Memo using `externalId`.
3. Close any RMA lines named in `closeLines`.
4. Transform the RMA into a Credit Memo.
5. Set the transaction date, location, department, memo, and custom fields.
6. Use the transformed RMA lines or replace them with `overrideItems`.
7. Add adjustment lines.
8. Save the Credit Memo and apply `balanceTo`, when requested.
9. Return the saved transaction details and the list of closed RMA lines.

## Response and errors

A successful response contains the Credit Memo `id`, `existing` flag, transaction header, item lines, optional balance information, and `closedLines`.

Common validation errors:

- `MISSING_FIELD`: a required field is absent.
- `INVALID_FIELD`: `closeLines` is not an array.
- NetSuite transformation or accounting errors are returned without creating a partial Credit Memo.

## Deployment names

| What | Value |
|---|---|
| Script | `HC_RL_CreateCreditMemoFromRma` |
| Script ID | `customscript_hc_rl_createcmfromrma` |
| Deployment ID | `customdeploy_hc_rl_createcmfromrma` |
| Script file | `/SuiteScripts/HotWaxCommerce/Return/HC_RL_CreateCreditMemoFromRma.js` |
