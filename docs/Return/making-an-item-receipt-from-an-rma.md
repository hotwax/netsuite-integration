*Design note · NetSuite integration*

# Making an item receipt from an RMA with a RESTlet

A RESTlet that receives returned pieces on a NetSuite RMA. It takes the same body as the REST record API and answers the same way, so it can run in a batch file.

> **Systems** HotWax OMS, NetSuite **Status** built and proven in the NetSuite sandbox; the OMS does not call it yet

## Why a RESTlet

The OMS records the pieces that arrive for a return as a return shipment. NetSuite records them as an item receipt made from the RMA. The OMS makes one with one REST call:

```
POST /services/rest/record/v1/returnAuthorization/{rmaId}/!transform/itemReceipt
```

The service `create#NetSuiteItemReceiptFromRma` in `mantle-netsuite-connector` sends it today. A transform turns one record into another. Here NetSuite copies the RMA's lines into a new item receipt.

The REST batch API cannot transform. So every item receipt is one call, one at a time.

A RESTlet can transform, and the File Cabinet batch can run any RESTlet over a file of records (see [Running a RESTlet as a batch job](https://github.com/hotwax/mantle-netsuite-connector/blob/main/docs/netsuite-batch-task/running-a-restlet-as-a-batch-job.md)). So a RESTlet that makes one item receipt gives us item receipts in batches.

## The rule: a near copy of the REST call

Anyone who can send the REST call can send the RESTlet call. The body is the REST body. The value REST carries in the address moves into the body. One more change: a line names its RMA line by the OMS's line id.

| REST call | RESTlet |
|---|---|
| `{rmaId}` in the path | `rmaId` in the body |
| `orderLine` on a line, NetSuite's line number on the RMA | `custcol_hc_order_line_id` on a line, the OMS's return line id |
| Every other field in the body | The same field, same name, same shape |

## The request

Values are illustrative.

```json
{
  "rmaId": "5001",
  "externalId": "M1001",
  "tranDate": "2026-01-20",
  "item": {
    "items": [
      {
        "custcol_hc_order_line_id": "01",
        "itemReceive": true,
        "quantity": 1,
        "restock": true,
        "location": { "id": "3" },
        "inventoryDetail": {
          "inventoryAssignment": {
            "items": [
              { "quantity": 1, "inventoryStatus": { "id": "1" }, "binNumber": { "id": "301" } }
            ]
          }
        }
      }
    ]
  }
}
```

What the fields mean:

- `rmaId` is the RMA's internal id. In REST it is `{rmaId}` in the path.
- `externalId` is the receipt's key. The OMS uses the return shipment's id. A second call with the same key makes no second receipt.
- `tranDate` is the day the pieces arrived, as `yyyy-MM-dd`.
- `item.items` has one entry for each RMA line the pieces belong to.
- `custcol_hc_order_line_id` names the RMA line. See the next section.
- `itemReceive`, `quantity`, `restock` and `location` are as in REST. NetSuite kept `restock` true when a body sent `false`, through REST and through the RESTlet alike.
- `inventoryDetail` is as in REST. It holds one assignment: the quantity, the inventory status, and the bin when the location has bins.
- A reference field, such as `location`, `inventoryStatus` or `binNumber`, is `{ "id": ... }`, as in REST.

## Naming a line

REST names an RMA line by `orderLine`, NetSuite's line number on the RMA. The RESTlet names it by `custcol_hc_order_line_id`, the OMS's return line id. The OMS writes that value on each RMA line when it makes the RMA. So the OMS needs no NetSuite line numbers.

The column is on the RMA's lines. A receipt made from the RMA leaves it empty on its own lines. So the RESTlet loads the RMA and finds the line that carries each id. On the receipt, each line's `orderLine` points back to its RMA line.

## What the RESTlet does

1. Check that `rmaId`, `externalId` and at least one line are there. If one is missing, write the audit entry and fail with `MISSING_FIELD`.
2. Look for an item receipt with the same `externalId`. If one exists, go to step 8.
3. Load the RMA. Find the RMA line for each `custcol_hc_order_line_id` in the body.
4. Transform the RMA into an item receipt. When nothing on the RMA is open, NetSuite refuses the transform, and the RESTlet fails with `LINE_NOT_OPEN` for every body line.
5. Set each header field from the body.
6. Set each receipt line whose RMA line the body names from that body line, the inventory detail included. Mark every other line not received.
7. If a body line has no open line on the receipt, fail with `LINE_NOT_OPEN` and make nothing. Otherwise save.
8. Write one audit entry and answer with the receipt's id.

A REST field name is the record's field id with a capital letter inside it, such as `tranDate` for `trandate`. The RESTlet finds the field id by lower-casing the name, as the RMA RESTlet does. This held for every field the OMS sends, in the inventory detail too.

The RESTlet works in standard mode. On the receipt, each line's `orderLine` is the RMA line's id, so the RESTlet matches on it.

The transform copies the RMA's department to the receipt and its lines. In the sandbox, the RESTlet's receipt and the REST receipt both carried the RMA's department.

## A line the body does not name

A transform starts the receipt from the RMA. Every open line starts marked received, at its open quantity. REST keeps a line the body does not name as it starts, so a REST caller must name every open line.

The RESTlet marks every line the body does not name as not received. The receipt then holds the pieces of one return shipment, and nothing else.

## A line that is not open

A body line can have no open line on the receipt. Then NetSuite already holds those pieces, or the RMA line is closed. That happens when a person received the pieces by hand, or closed the line.

A receipt without that line would not match the return shipment. So the call fails with `LINE_NOT_OPEN`, names the lines, and makes nothing. A person checks the RMA.

## Running it again

A receipt is made with one save. A call that fails makes nothing, so the same call again starts fresh.

A call can also succeed while its answer is lost. The same call again finds the receipt by `externalId` and answers `existing: true`. It changes nothing on the receipt.

## The answer

```json
{ "id": "6001", "existing": false }
```

- `id` is the item receipt's internal id. REST gives the same id in its `Location` header.
- `existing` is `true` when step 2 found the receipt, and `false` when this call made it.

The answer has no line ids. The batch runner keeps only `externalId`, the id and `existing` for each record. The OMS writes the id on the return shipment.

## Errors

The RESTlet throws an error with a name and a message. In a direct call, NetSuite answers `400` with this body:

```json
{ "error": { "code": "<error name>", "message": "<NetSuite's error as JSON text>" } }
```

In a batch, the runner writes the error as the record's `errorMessage`, in this shape:

```json
{ "externalId": "M1001", "errorMessage": "<error name>: <error message>" }
```

The RESTlet throws two names of its own:

- `MISSING_FIELD`, when `rmaId`, `externalId` or the lines are missing. The message is `rmaId, externalId and item.items are required`.
- `LINE_NOT_OPEN`, when a body line has no open line on the receipt, or nothing on the RMA is open. The message names the RMA and each return line id, such as `RMA 5001 has no open line for 02`.

Every other name is NetSuite's. A date in a closed period comes back as `THE_TRANSACTION_DATE_YOU_SPECIFIED_IS_NOT_WITHIN_AN_OPEN_ACCOUNTING_PERIOD_CLICK_OK_TO_CHANGE_THE_TRANSACTION_DATE_TO_A_DATE_WITHIN_AN_OPEN_PERIOD`.

## What monitoring sees

Each call writes one AUDIT entry to the script execution log. The title is `ItemReceipt [External ID: <externalId>]`. The details are JSON:

```json
{ "rmaId": "5001", "id": "6001", "existing": false }
```

Three more keys appear only when they have a value:

- `missingLines`: each `custcol_hc_order_line_id` with no open line on the receipt. The call fails with `LINE_NOT_OPEN`.
- `missingFields`: `rmaId`, `externalId` or `item.items`, when the body lacks it. The call fails with `MISSING_FIELD`.
- `error`: the error's name, when the call fails. `id` is null then.

In a batch, the runner loads the RESTlet into its own run. So the entries land in the log of `HC_MR_RunBatchFile`, not in the RESTlet's log. The deployment's log level must stay at AUDIT or DEBUG.

## Where it differs from REST

| | REST call | RESTlet | Why |
|---|---|---|---|
| Naming a line | `orderLine`, NetSuite's line number | `custcol_hc_order_line_id`, the OMS's return line id | The OMS keeps its own line id |
| A line the body does not name | Received at its open quantity | Not received | The receipt holds one return shipment |
| A body line with no open line | NetSuite's error | `LINE_NOT_OPEN`, naming the lines | Monitoring and the OMS see which lines |
| Same `externalId` twice | NetSuite refuses the second call | Answers with the receipt that exists | A batch can be run again safely |
| Success | `204`, id in the `Location` header | `{ id, existing }` in the body | A RESTlet has no `Location` header |
| `externalId` | Optional | Required | It is the key that makes a second call safe |
| The receipt's source | `REST Web Services` | Empty | A script made the receipt |
| Naming a kit's member line | `orderLine` of the member line | The kit line's `custcol_hc_order_line_id` and the component's `item` | NetSuite adds member lines with no OMS line id |

NetSuite's warnings are not returned. Everything else is the REST call.

## Kits

On an RMA, NetSuite adds a member line under each kit line. A member line has the component's item and its quantity. It carries no `custcol_hc_order_line_id`. Its `kitmemberof` names the kit line.

A body names a member line with two fields: the kit line's `custcol_hc_order_line_id`, and the component's `item`. The RESTlet reads the RMA's member lines with SuiteQL, `kitmemberof` included, and finds the one under that kit line with that item. `item` is used only to find the line. It is not set.

```json
{ "custcol_hc_order_line_id": "01", "itemReceive": true, "quantity": 1, "restock": true, "location": { "id": "31" } },
{ "custcol_hc_order_line_id": "01", "item": { "id": "4002" }, "quantity": 2, "location": { "id": "31" },
  "inventoryDetail": { "inventoryAssignment": { "items": [
    { "quantity": 2, "inventoryStatus": { "id": "1" }, "binNumber": { "id": "301" } } ] } } }
```

The kit line holds the number of kits and no inventory detail. Each member line holds its pieces and the inventory detail: the status, and the bin when the location has bins.

The body must name every member line of a kit it receives. A member the body does not name is not received, like any other line. NetSuite then saves a receipt whose kit line is received but no piece reaches stock. The sandbox showed this for a kit line sent alone, at a location with bins and at one without.

## Two ways to run it

- **One call.** `POST` the body to the RESTlet's URL. The answer comes back at once.
- **A batch.** Write one body per line into a file. The batch runner `HC_MR_RunBatchFile` calls the RESTlet for each line and writes one result per line.

## How anyone can read its API

NetSuite does not publish an API for a RESTlet. We publish it ourselves, in three parts.

1. **An OpenAPI file in the repo.** OpenAPI is the standard way to describe an API. NetSuite uses it for its own record API. The file sits beside the script and is reviewed with it.
2. **`GET` on the RESTlet returns that file.** Anyone with access calls `GET` on the same URL and reads the API of the version deployed in that account.
3. **The body fields point to NetSuite's own description.** Our body is NetSuite's `itemReceipt` body. NetSuite describes it for each account, custom fields included:

   ```
   GET /services/rest/record/v1/metadata-catalog/itemReceipt
   Accept: application/swagger+json
   ```

   The OpenAPI file names this address. It describes only what is ours: `rmaId`, `custcol_hc_order_line_id` as the line's name, the answer, and the differences above. So our file cannot fall out of step with NetSuite's fields.

## Names

The names follow the scripts already in the account.

| What | Name | Follows |
|---|---|---|
| Script | `HC_RL_CreateItemReceiptFromRma` | `HC_RL_CreateCreditMemoFromRma` |
| Script id | `customscript_hc_rl_createirfromrma` | `customscript_hc_rl_createcmfromrma` |
| Deployment id | `customdeploy_hc_rl_createirfromrma` | `customdeploy_hc_rl_creatermafromso` |
| OpenAPI file | `HC_RL_CreateItemReceiptFromRma.openapi.json` | the script's name |
| Deploy file | `src/deploy.xml` | `src/deploy.xml` |

## What the sandbox proved

All in the NetSuite sandbox, before the OMS uses it.

1. `HC_RL_CreateRmaFromSalesOrder` made the test RMAs from one billed sales order, each with return lines `01` and `02`.
2. Line `01` of one RMA was received with the REST call, using `orderLine`. Line `01` of a second RMA, made from the same body, was received with the RESTlet. Every header and line field matched, the inventory detail too. Only the ids, the number, the source RMA and the source differed.
3. A line at a location with bins, with bin `RMA REC BIN` and status QC: the inventory detail carried both.
4. The same body again answered `existing: true` with the same id. NetSuite had no new receipt.
5. A line already received failed with `LINE_NOT_OPEN`. Nothing was made, and the audit entry named the line.
6. A return line id not on the RMA failed with `LINE_NOT_OPEN`.
7. A body without `externalId` failed with `MISSING_FIELD`. The audit entry named the field.
8. A date in a closed period came back with NetSuite's error name. Nothing was made.
9. The line the body did not name stayed unreceived.
10. The receipt and its lines carried the RMA's department.
11. A batch of three bodies through `HC_MR_RunBatchFile`: two receipts and one `LINE_NOT_OPEN`, one result line each. The audit entries were in the log of `HC_MR_RunBatchFile`.
12. `GET` answered the OpenAPI file.
13. A body for an RMA with nothing open failed with `LINE_NOT_OPEN`. Nothing was made.
14. `restock: false` came back `true` on the receipt, with the REST call and with the RESTlet.
15. A kit with its member line, at a location with bins: the member line carried the bin and status Good, and it was the line that moved stock. The receipt had the same lines as a production receipt for the same kit.
16. A kit with its member line at a store without bins, status QC: the member line carried the status, and it moved stock.
17. A kit line sent alone, at a location with bins and at one without: NetSuite saved the receipt, but the member was not received and no stock moved.

## What comes after this note

The OMS side is designed separately, in `docs/returns/return-shipments-due.md` in `gorjana-maarg`. It covers two parts:

- the job that picks received return shipments by rule and writes the batch;
- the step that records each receipt id on its return shipment.
