# Making a customer refund from a credit memo with a RESTlet

## Purpose

`HC_RL_CreateCustomerRefundFromCreditMemo` transforms an open NetSuite Credit Memo into a Customer Refund and applies a requested amount from that Credit Memo.

The operation is idempotent by `externalId`. Retrying a successful request returns the existing Customer Refund with `existing: true`.

## Request

Required fields:

| Field | Description |
|---|---|
| `creditMemoId` | Internal ID of the Credit Memo |
| `externalId` | Stable external ID used for idempotency |
| `paymentMethodId` | NetSuite payment-method internal ID |
| `amount` | Amount to refund and apply |
| `tranDate` | Transaction date in `YYYY-MM-DD` format |
| `locationId` | NetSuite location internal ID |
| `departmentId` | NetSuite department internal ID |

Example:

```json
{
  "creditMemoId": "23456",
  "externalId": "HC-REFUND-10001",
  "paymentMethodId": "8",
  "amount": 49.95,
  "tranDate": "2026-10-13",
  "locationId": "7",
  "departmentId": "3",
  "memo": "OMS return refund"
}
```

Optional fields:

- `memo`: transaction memo.
- `customFields`: object containing Customer Refund body field IDs and values.

## Processing

1. Validate the request.
2. Search for an existing Customer Refund using `externalId`.
3. Transform the Credit Memo into a Customer Refund.
4. Set payment method, date, location, department, memo, and custom fields.
5. Read the open amount on the Credit Memo.
6. Refuse the request when `amount` exceeds the amount due.
7. Apply the requested amount, save the refund, and return both refund and Credit Memo information.

## Response and errors

The response includes the Customer Refund `id`, `existing` flag, header fields, the apply sublist, and the source Credit Memo with its remaining balance.

Common errors:

- `MISSING_FIELD`: a required field is absent.
- `AMOUNT_EXCEEDS_DUE`: the requested amount is greater than the Credit Memo's open amount.
- NetSuite transformation or accounting errors are returned without saving the refund.

## Deployment names

| What | Value |
|---|---|
| Script | `HC_RL_CreateCustomerRefundFromCreditMemo` |
| Script ID | `customscript_hc_rl_createrefundfromcm` |
| Deployment ID | `customdeploy_hc_rl_createrefundfromcm` |
| Script file | `/SuiteScripts/HotWaxCommerce/Return/HC_RL_CreateCustomerRefundFromCreditMemo.js` |
