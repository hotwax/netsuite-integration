*Design note · NetSuite integration*

# Making an RMA from a sales order with a RESTlet

A RESTlet that turns a NetSuite sales order into an RMA. It takes the same body as the REST record API and answers the same way, so it can run in a batch file.

> **Systems** HotWax OMS, NetSuite **Status** built and proven in the NetSuite sandbox; the OMS does not call it yet

## Why a RESTlet

The OMS makes an RMA from a sales order with one REST call:

```
POST /services/rest/record/v1/salesOrder/{salesOrderId}/!transform/returnAuthorization?replace=item
```

The service `create#NetSuiteRmaFromSalesOrder` in `mantle-netsuite-connector` sends it today. A transform turns one record into another. Here NetSuite copies the customer and the sale from the order into a new RMA.

The REST batch API takes up to a hundred records in one call. It can add, update, upsert or delete records. It cannot transform. So every RMA from a sales order is one call, one at a time.

A RESTlet is a small script that lives inside NetSuite. A RESTlet can transform, and the File Cabinet batch can run any RESTlet over a file of records (see [Running a RESTlet as a batch job](https://github.com/hotwax/mantle-netsuite-connector/blob/main/docs/netsuite-batch-task/running-a-restlet-as-a-batch-job.md)). So a RESTlet that makes one RMA gives us RMAs in batches.

## The rule: a near copy of the REST call

Anyone who can send the REST call can send the RESTlet call. The body is the REST body. The two values REST carries in the address move into the body. Nothing else changes.

| REST call | RESTlet |
|---|---|
| `{salesOrderId}` in the path | `salesOrderId` in the body |
| `?replace=item` in the query | `replace: "item"` in the body |
| Every other field in the body | The same field, same name, same shape |

## The request

The REST body, as the OMS sends it today. Values are illustrative.

```json
{
  "externalId": "HC-RMA-M1001",
  "entity": { "id": "2001" },
  "tranDate": "2026-01-15",
  "discountRate": 0,
  "memo": "Return M1001",
  "location": { "id": "3" },
  "department": { "id": "7" },
  "custbody11": "2026-01-15",
  "custbody_ava_disable_tax_calculation": true,
  "item": {
    "items": [
      {
        "item": { "id": "4001" },
        "quantity": 1,
        "price": -1,
        "rate": 75.00,
        "location": { "id": "3" },
        "taxCode": { "id": "-7" },
        "custcol_hc_order_line_id": "00001"
      }
    ]
  }
}
```

The RESTlet body is the same, with two more fields:

```json
{
  "salesOrderId": "3001",
  "replace": "item",
  "externalId": "HC-RMA-M1001",
  "...": "every other field exactly as above"
}
```

What the fields mean:

- `externalId` is the RMA's key. The caller names it. A second call with the same key makes no second RMA.
- A reference field, such as `entity`, `location`, `department`, `item` or `taxCode`, is `{ "id": ... }`, as in REST.
- `shippingAddress` and `billingAddress` are address objects, as in REST: `addressee`, `addr1`, `addr2`, `city`, `state`, `zip`, `country`.
- `price: -1` on a line means a custom price. NetSuite then keeps the line's `rate` as given.
- Custom fields (`custbody...` on the header, `custcol...` on a line) sit at the top level of the body or the line, as in REST.
- Dates are `yyyy-MM-dd`, as in REST.

## What the RESTlet does

1. Check that `salesOrderId` and `externalId` are there. If one is missing, write the audit entry and fail with `MISSING_FIELD`.
2. Look for an RMA with the same `externalId`. If one exists, go to step 8.
3. Transform the sales order `salesOrderId` into an RMA.
4. When `replace` is `item`, remove every line the transform copied from the order.
5. Set each header field from the body. Set the customer only when it differs from the order's.
6. Add each line from `item.items`, in order. Then set the addresses.
7. Save.
8. Close each line the body marked `isClosed: true` that is still open on the RMA. A marked line that is not on the RMA is named in the audit entry, and the call goes on. Save again only when a line changed.
9. Write one audit entry and answer with the RMA's id.

The sandbox showed why the steps run this way:

- The transform runs in dynamic mode. In standard mode, the save failed when the body carried an address.
- The addresses are set after the lines. NetSuite takes each line's tax code from the shipping address, as REST does.
- The customer is set only when it differs from the order's. Setting the same customer again cleared the addresses the transform copied from the order. REST keeps them.

A REST field name is the record's field id with a capital letter inside it, such as `tranDate` for `trandate`. The RESTlet finds the field id by lower-casing the name. This held for every field the OMS sends.

## Running it again

A call can fail after the first save. Then the RMA exists, but the lines to close are still open. The same call again finishes the job:

- It finds the RMA by `externalId` and answers `existing: true`.
- It closes each line marked `isClosed: true` that is still open.
- It changes nothing else on the RMA.
- When no line needs closing, it does not save.

The RESTlet finds each body line on the RMA by its `item` and `custcol_hc_order_line_id`. NetSuite adds lines of its own, such as tax lines. Those lines have other items, so they do not shift the match. Two body lines with the same item and order line id pair with the RMA's lines in the same order. The match starts from the last line, so lines the transform copied, when `replace` is not `item`, are not taken.

When a line marked `isClosed: true` has no line on the RMA, the call does not fail. The RESTlet names the line in the audit entry, closes the other marked lines, and answers the RMA.

NetSuite drops a trailing space from `custcol_hc_order_line_id` when it saves. A body value with a trailing space then matches no RMA line. That line stays open and is named in the audit entry.

## The answer

```json
{ "id": "5001", "existing": false }
```

- `id` is the RMA's internal id. REST gives the same id in its `Location` header.
- `existing` is `true` when step 1 found the RMA, and `false` when this call made it.

The answer has no line ids. The batch runner keeps only `externalId`, the id and `existing` for each record. The OMS reads the RMA's lines afterwards and matches each one by `custcol_hc_order_line_id`, as it already does after the REST call.

## Errors

The RESTlet throws an error with a name and a message. In a direct call, NetSuite answers `400` with this body:

```json
{ "error": { "code": "<error name>", "message": "<NetSuite's error as JSON text>" } }
```

The message is NetSuite's error as JSON text. Parse it to read its `name` and `message`.

In a batch, the runner writes the error as the record's `errorMessage`, in this shape:

```json
{ "externalId": "HC-RMA-M1001", "errorMessage": "<error name>: <error message>" }
```

The RESTlet throws one name of its own: `MISSING_FIELD`, when `salesOrderId` or `externalId` is missing. The message is `salesOrderId and externalId are required`.

Every other name is NetSuite's, such as `INVALID_FLD_VALUE`. `RCRD_HAS_BEEN_CHANGED` means another update saved the RMA while the RESTlet was closing its lines. The same call again finishes the job.

NetSuite makes an RMA only from a sales order that is billed or closed. The RESTlet does not check this. NetSuite refuses the transform, as it does for the REST call.

## What monitoring sees

Each call writes one AUDIT entry to the script execution log. The title is `RMA [External ID: <externalId>]`. The details are JSON:

```json
{ "id": "5001", "existing": false, "closedLines": 1 }
```

Three more keys appear only when they have a value:

- `missingLines`: each line marked `isClosed: true` that is not on the RMA, by its `item` and `custcol_hc_order_line_id`. The call still answers the RMA.
- `missingFields`: `salesOrderId` or `externalId`, when the body lacks it. The call fails with `MISSING_FIELD`.
- `error`: the error's name, when the call fails. `id` is null when the call failed before the first save.

```json
{ "id": "5001", "existing": false, "closedLines": 1, "missingLines": [{ "item": "4002", "custcol_hc_order_line_id": "00002" }] }
```

```json
{ "id": null, "existing": false, "closedLines": 0, "missingFields": ["externalId"], "error": "MISSING_FIELD" }
```

```json
{ "id": "5001", "existing": false, "closedLines": 0, "error": "RCRD_HAS_BEEN_CHANGED" }
```

When `externalId` is missing, the title is `RMA [External ID: ]`.

The entry is an AUDIT entry, also for a missing line. SuiteScript has no WARN level. Its levels are DEBUG, AUDIT, ERROR and EMERGENCY. A missing line is not a failure, so it is not an ERROR. It stays in the call's one entry, and monitoring finds it by `missingLines` in the details. The deployment's log level must stay at AUDIT or DEBUG. At ERROR, NetSuite drops AUDIT entries.

NetSuite also writes its own entry for every error, titled with the error's name. In a batch, the runner also logs each refused line with its `externalId`.

In a batch, the runner loads the RESTlet into its own run. So the entries land in the log of `HC_MR_RunBatchFile`, not in the RESTlet's log. Search both scripts by the title.

SuiteQL reads the log from the table `scriptnote`. Find a call by its title. Sort by `date`, not by `internalid`: the ids do not follow time.

## Where it differs from REST

| | REST call | RESTlet | Why |
|---|---|---|---|
| Same `externalId` twice | NetSuite refuses the second call | Answers with the RMA that exists, and closes its marked lines that are still open | A batch can be run again safely, and a failed close gets finished |
| `isClosed: true` on a line | Ignored when the RMA is made | Applied right after the first save | Saves the OMS a second call |
| Success | `204`, id in the `Location` header | `{ id, existing }` in the body | A RESTlet has no `Location` header |
| `externalId` | Optional | Required | It is the key that makes a second call safe |
| The RMA's `source` | `REST Web Services` | Empty | A script made the RMA |

NetSuite's warnings are not returned.

Everything else is the REST call. A body field the RMA does not have is ignored, as REST does.

## Two ways to run it

- **One call.** `POST` the body to the RESTlet's URL. The answer comes back at once.
- **A batch.** Write one body per line into a file. The batch runner `HC_MR_RunBatchFile` calls the RESTlet for each line and writes one result per line.

## How anyone can read its API

NetSuite does not publish an API for a RESTlet. We publish it ourselves, in three parts.

1. **An OpenAPI file in the repo.** OpenAPI is the standard way to describe an API. NetSuite uses it for its own record API. The file sits beside the script and is reviewed with it.
2. **`GET` on the RESTlet returns that file.** Anyone with access calls `GET` on the same URL and reads the API of the version deployed in that account.
3. **The body fields point to NetSuite's own description.** Our body is NetSuite's `returnAuthorization` body. NetSuite describes it for each account, custom fields included:

   ```
   GET /services/rest/record/v1/metadata-catalog/returnAuthorization
   Accept: application/swagger+json
   ```

   The OpenAPI file names this address. It describes only what is ours: `salesOrderId`, `replace`, the answer, and the differences above. So our file cannot fall out of step with NetSuite's fields.

## Names

The names follow the scripts already in the account.

| What | Name | Follows |
|---|---|---|
| Script | `HC_RL_CreateRmaFromSalesOrder` | `HC_RL_CreateCreditMemoFromRma` |
| Script id | `customscript_hc_rl_creatermafromso` | `customscript_hc_rl_createcmfromrma` |
| OpenAPI file | `HC_RL_CreateRmaFromSalesOrder.openapi.json` | the script's name |

## What the sandbox proved

All in the NetSuite sandbox, before the OMS uses it.

1. One billed sales order, one body, two external ids. One RMA was made with the RESTlet, with a zero line marked `isClosed: true`. The other was made with the REST call, and its zero line was then closed by a REST update, as the OMS does today. Every header and line field matched, except the id, the number, the external id and `source`.
2. Closing a line clears the RMA's ship method. The REST update that closes a line does the same, so the RESTlet leaves it.
3. The same body again answers `existing: true`. NetSuite has no new RMA.
4. A line with an item that does not exist: NetSuite's error comes back with its name.
5. A zero line marked `isClosed: true` is closed after the call.
6. A batch file of three bodies through `HC_MR_RunBatchFile`: the result file has three lines with the three ids.
7. `GET` answers the OpenAPI file.
8. A failed close. Another update saved the RMA between the RESTlet's read and its close. NetSuite refused the close with `RCRD_HAS_BEEN_CHANGED`, and the zero line stayed open. The same call again answered `existing: true`, closed the line, and kept the other update's change.
9. The same call once more found nothing to close and did not save.
10. A body with a normal line and a marked line whose `custcol_hc_order_line_id` ended in a space. NetSuite saved the value without the space, so the marked line matched no RMA line. The call answered `existing: false`. The audit entry named the line in `missingLines`, and the line stayed open.
11. The same body again answered `existing: true` with the same id. The entry named the line again. Nothing was saved.
12. On that RMA, a body with one marked line that was on the RMA and one that was not. The first was closed. The second was named in `missingLines`.
13. A body without `externalId`, and one without `salesOrderId`. Each answered `400` with `MISSING_FIELD` and the same message as before. Our audit entry named the missing field in `missingFields`. No RMA was made.
14. A normal body with a marked line that was on the RMA still closed it. The entry had no `missingLines`.
15. A batch of two bodies through `HC_MR_RunBatchFile`, one with a marked line not on the RMA. Both came back with ids, and none was refused. Both audit entries were in the log of `HC_MR_RunBatchFile`.

## What comes after this note

The OMS side is designed separately: the batch message type, the job that picks in-progress returns by rule, and the step that records the RMA and its lines.
