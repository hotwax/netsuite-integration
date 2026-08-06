# netsuite-integration
HotWax Commerce - NetSuite integration

## Transfer Order V2 cancellation export sample

The warehouse transfer order cancellation export writes CSV files to:

`transferorderv2/export/cancel`

CSV columns:

- `orderName`: NetSuite transfer order number (`tranid`)
- `lineId`: NetSuite transfer order item sublist line id
- `closed`: always `true` for cancelled/closed lines

Sample file:

- [TransferOrderCancellationSample.csv](/Users/nutanshinde/IdeaProjects/moqui-framework/runtime/component/netsuite-integration/examples/transferorderv2/TransferOrderCancellationSample.csv)
