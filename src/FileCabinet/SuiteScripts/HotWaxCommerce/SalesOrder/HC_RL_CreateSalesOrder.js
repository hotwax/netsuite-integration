/**
 * createSalesOrderRestlet.js
 *
 * SuiteScript 2.1 RESTlet that creates a NetSuite Sales Order via record.create()/save() -
 * i.e. through NetSuite's normal internal transaction-save pipeline, the same one a UI save goes
 * through - rather than the generic REST Record API (record/v1/salesOrder). On this account,
 * SuiteTax is disabled (legacy tax engine), and NetSuite's REST web services are documented to
 * not support legacy tax features - taxCode/taxRate1 set via record/v1/salesOrder are silently
 * ignored (order creates fine, no error, tax just never computes). A RESTlet runs the same
 * internal save logic as the UI/SOAP, so legacy tax computation should run correctly here.
 *
 * NOT DEPLOYED ANYWHERE YET - this file is a source/reference copy kept in the rails component
 * for now. To use it, a NetSuite user with SuiteScript access needs to:
 *   1. Upload this file to the NetSuite File Cabinet.
 *   2. Create a Script record (Script Type: RESTlet) pointing at it, with a Script Deployment.
 *   3. Add a SystemProperty row (systemResourceId="Restlet_Config",
 *      systemPropertyId="netsuite.restlet.salesorder.create", value=<deployment's External URL>)
 *      in OMS - that's what rails' create#NetSuiteSalesOrderRestlet service looks up to call it.
 *
 * ---------------------------------------------------------------------------------------------
 * REQUEST BODY CONTRACT (produced by rails'
 * prepare#NetSuiteSalesOrderRestletPayload service, co.hotwax.rails.netsuite.
 * NetSuiteSalesOrderRestletServices - see that service for exactly how each bucket is built):
 *
 * {
 *   "header": {
 *     "valueFields": { "<fieldId>": <value> },     // record.setValue() - internal ids, numbers,
 *                                                   // strings, booleans (e.g. entity, subsidiary,
 *                                                   // location, department, customform,
 *                                                   // cseg_atlas_sls_chan, custbody_* fields,
 *                                                   // isCrossSubTransaction)
 *     "textFields": { "<fieldId>": "<text>" },     // record.setText() - display text/refName
 *                                                   // fields where the OMS side only has the
 *                                                   // display value, not NetSuite's internal id
 *                                                   // (currently just "currency", e.g. "USD")
 *     "dateFields": {                              // native `new Date(value)` before setValue()
 *       "<fieldId>": { "value": "<ISO 8601 string>", "dateTime": true|false }
 *     }
 *   },
 *   "shippingAddress": { "addressee", "addr1", "addr2", "city", "state", "zip", "phone",
 *                         "country" } | null,      // plain fields, set directly on the address
 *                                                   // subrecord - "country" is already the
 *                                                   // 2-letter ISO code (not a [id]/[refName] map)
 *   "billingAddress": { ...same shape... } | null,
 *   "items": [
 *     {
 *       "valueFields": { "<fieldId>": <value> },   // setCurrentSublistValue()
 *       "textFields": { "<fieldId>": "<text>" }    // setCurrentSublistText() - currently just
 *                                                   // "taxcode" (e.g. "Taxable")
 *     }
 *   ]
 * }
 *
 * RESPONSE CONTRACT (this script's own design, parsed by create#NetSuiteSalesOrderRestlet):
 *   success: { "success": true, "internalId": "12345" }
 *   failure: { "success": false, "error": "<message>", "name": "<error name>" }
 * ---------------------------------------------------------------------------------------------
 *
 * TODO - FIELD IDS NOT YET VERIFIED AGAINST THIS SPECIFIC NETSUITE ACCOUNT:
 *   NetSuite's *standard* field ids used below (entity, subsidiary, location, department,
 *   trandate, currency, tranid, the "item" sublist's item/quantity/price/rate/taxcode/
 *   taxrate1/closed columns, and the shippingaddress/billingaddress subrecord's addressee/addr1/
 *   addr2/city/state/zip/country/phone fields) are the commonly-documented SuiteScript ids for a
 *   Sales Order and should hold across accounts, but were researched via public docs/community
 *   references, NOT confirmed against this account's own SuiteScript Records Browser (Setup >
 *   SuiteScript > Records Browser > salesorder). The custom fields (custbody_*, custcol_*,
 *   cseg_atlas_sls_chan) are NOT a concern - those internal ids are account-global and already
 *   confirmed via the client's own REST API GET responses used throughout this integration, so
 *   they're the same ids here. Before relying on this in production:
 *     - Confirm "currency" and "taxcode" are genuinely List/Record (select) fields expecting
 *       setText() with the display value, not setValue() with an internal id.
 *     - Confirm "state" on the address subrecord accepts the plain 2-letter code via setValue()
 *       the same way "country" does (per Tim Dietrich's SuiteScript guide example for country) -
 *       it may need setText() instead depending on how the account's State/Province list is set up.
 *     - Confirm "custcol_r_shopify_line_location" and "inventorylocation" are List/Record
 *       (internal-id) fields, not free text - this integration always sends an id-shaped value for
 *       both, so setCurrentSublistValue() is used, matching the REST payload's [id: ...] shape.
 *
 * record.Type.SALES_ORDER is confirmed directly against Oracle's own N/record module reference
 * page - not an assumption.
 *
 * Bug found and fixed: date/datetime fields were originally parsed with format.parse({type:
 * format.Type.DATE/DATETIME}), which expects the account's own locale date/time format - passing
 * a raw ISO 8601 string like "2026-07-25T23:49:44Z" through it caused NetSuite to reject
 * custbody_rails_created_time_orig_order with INVALID_FLD_VALUE. Switched to native
 * `new Date(value)`, which parses ISO 8601 (with or without a "Z"/UTC suffix) correctly per the JS
 * spec regardless of the account's locale format - setValue() accepts a native Date object
 * directly for date/datetime fields, so N/format isn't needed here at all anymore.
 *
 * Bug found and fixed: a date-only entry (dateTime: false, e.g. trandate = "2026-07-26") was
 * still going through `new Date(value)`, which parses a bare "YYYY-MM-DD" string as midnight UTC
 * per the ECMAScript spec - not local midnight. Since trandate is a calendar date, not an instant,
 * this shifted it back a day whenever the account's timezone is behind UTC (sending 2026-07-26
 * was stored in NetSuite as 2026-07-25). Fixed by parsing the Y/M/D parts explicitly and using the
 * multi-argument Date constructor (new Date(year, monthIndex, day)), which the spec defines as
 * local-time construction with no UTC conversion.
 *
 * Bug found and fixed: dateTime: true entries (e.g. custbody_rails_created_time_orig_order) had
 * the same problem in the opposite direction - Moqui sends this field as the order's original
 * account-local wall-clock time with a trailing "Z" (a required literal character, not a real UTC
 * marker), but new Date(value) parses that "Z" as genuine UTC, and NetSuite then displays the
 * resulting instant converted into the account's own timezone - a double conversion. Extended the
 * same Y/M/D-plus-local-constructor approach to dateTime: true entries (adding H/M/S), ignoring
 * any trailing zone designator in the string entirely. See parseDateEntry().
 *
 * Performance: a bulk backfill of ~1800 orders one-at-a-time through this RESTlet took ~4.5 hours.
 * Two of the biggest per-order costs were debugging leftovers from the tax-ordering bug hunt above:
 * a full record.load() reload after every save() just to log NetSuite's computed tax state, and
 * log.debug() calls firing per line, twice per order (before and after save). Neither is needed
 * once the ordering bug above was confirmed fixed, so both were removed - the request body is now
 * only logged when an order actually fails (inside the catch block), not on every success.
 */

/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/log'], function (record, log) {

    function setBodyFields(rec, valueFields, textFields, dateFields) {
        if (valueFields) {
            Object.keys(valueFields).forEach(function (fieldId) {
                rec.setValue({ fieldId: fieldId, value: valueFields[fieldId] })
            })
        }
        if (textFields) {
            Object.keys(textFields).forEach(function (fieldId) {
                rec.setText({ fieldId: fieldId, text: textFields[fieldId] })
            })
        }
        if (dateFields) {
            // Bug found and fixed: format.parse({type: format.Type.DATETIME}) expects the
            // account's own locale date/time format, not a raw ISO 8601 string - sending
            // "2026-07-25T23:49:44Z" through it caused NetSuite to reject
            // custbody_rails_created_time_orig_order with INVALID_FLD_VALUE. setValue() accepts a
            // native Date object directly for date/datetime fields, so format.parse() isn't
            // needed at all - see parseDateEntry() for how that Date object gets built.
            Object.keys(dateFields).forEach(function (fieldId) {
                var entry = dateFields[fieldId]
                rec.setValue({ fieldId: fieldId, value: parseDateEntry(entry) })
            })
        }
    }

    // Bug found and fixed: for a date-only entry (dateTime: false, e.g. "2026-07-26" for
    // trandate), `new Date(value)` is wrong - the ECMAScript spec parses a bare "YYYY-MM-DD"
    // string as midnight UTC, not local midnight. trandate is a calendar date, not an instant in
    // time, so if the account's timezone is behind UTC (any US timezone), midnight UTC on the 26th
    // falls on the evening of the 25th local time, and NetSuite stores/displays it as the 25th -
    // one day earlier than what was sent. Fixed by parsing the Y/M/D parts explicitly and using
    // the multi-argument Date constructor (new Date(year, monthIndex, day)), which the spec
    // defines as local-time construction with no UTC conversion involved.
    //
    // Bug found and fixed: custbody_rails_created_time_orig_order (dateTime: true) had the same
    // problem in the opposite direction. Moqui sends this field as the order's original Pacific
    // wall-clock time with a trailing "Z" (just a literal character, not a real UTC marker -
    // same convention as this field's own comment on the Moqui side). new Date(value) instead
    // parses that "Z" as genuine UTC per the JS spec, and NetSuite then displays the resulting
    // instant converted into the account's own timezone - a double conversion. Confirmed against
    // a real order: NetSuite showed a value exactly the account's UTC offset earlier than
    // Shopify's created_at. Fixed by extending the same Y/M/D/H/M/S-components-plus-local-
    // constructor approach to dateTime: true entries too, ignoring any trailing zone designator
    // in the string entirely - both branches now agree that the numbers in the string ARE the
    // account's local wall-clock value, with no conversion on either side.
    function parseDateEntry(entry) {
        var match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(entry.value)
        if (!match) {
            return new Date(entry.value)
        }
        var year = parseInt(match[1], 10)
        var monthIndex = parseInt(match[2], 10) - 1
        var day = parseInt(match[3], 10)
        if (!entry.dateTime) {
            return new Date(year, monthIndex, day)
        }
        var hours = parseInt(match[4], 10)
        var minutes = parseInt(match[5], 10)
        var seconds = parseInt(match[6], 10)
        return new Date(year, monthIndex, day, hours, minutes, seconds)
    }

    function setAddress(rec, fieldId, address) {
        if (!address) return
        var subrecord = rec.getSubrecord({ fieldId: fieldId })
        // Bug found and fixed: in dynamic mode, setting "country" on an address subrecord makes
        // NetSuite re-derive the address form/layout for that country, resetting any fields
        // already set on the subrecord to match the new form. Setting country first (before
        // addr1/city/zip/etc.) avoids that reset - observed in production as international
        // orders (non-default country) saving with only "country" populated on the shipping/
        // billing address and every other address field silently wiped, while domestic orders
        // (country unchanged from the subrecord's default) were unaffected.
        if (address.country) {
            subrecord.setValue({ fieldId: 'country', value: address.country })
        }
        Object.keys(address).forEach(function (key) {
            if (key === 'country') return
            var value = address[key]
            if (value === null || value === undefined || value === '') return
            subrecord.setValue({ fieldId: key, value: value })
        })
    }

    function setItemLines(rec, items) {
        (items || []).forEach(function (line) {
            rec.selectNewLine({ sublistId: 'item' })
            var valueFields = line.valueFields || {}
            var textFields = line.textFields || {}

            // Bug found and fixed (twice): field order matters for tax sourcing.
            // 1) "item" must be set BEFORE "taxcode" - which tax codes are even valid/selectable
            //    on a line is itself sourced from the item's own tax schedule under the current
            //    subsidiary/nexus. Setting taxcode before item meant NetSuite had no item context
            //    to validate "Taxable" against, so the text match silently failed to apply, and
            //    the line's taxcode got re-sourced to the item's own default under this
            //    subsidiary once item was set afterward (observed: silently became
            //    "-Not Taxable-" instead of "Taxable" for a different subsidiary than the one
            //    this was first tested against).
            // 2) "taxcode" must still be set BEFORE "taxrate1" - assigning taxcode is itself a
            //    sourcing trigger that recomputes the line's tax rate, so setting it after
            //    taxrate1 silently overwrites our explicit taxrate1 value (the original bug this
            //    ordering fix addressed).
            // Correct order: item (and everything else) first, then taxcode, then taxrate1 last.
            if (valueFields.item !== undefined) {
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: valueFields.item })
            }
            Object.keys(valueFields).forEach(function (fieldId) {
                if (fieldId === 'item' || fieldId === 'taxrate1') return
                rec.setCurrentSublistValue({
                    sublistId: 'item', fieldId: fieldId, value: valueFields[fieldId]
                })
            })
            Object.keys(textFields).forEach(function (fieldId) {
                rec.setCurrentSublistText({
                    sublistId: 'item', fieldId: fieldId, text: textFields[fieldId]
                })
            })
            if (valueFields.taxrate1 !== undefined) {
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxrate1', value: valueFields.taxrate1 })
            }

            rec.commitLine({ sublistId: 'item' })
        })
    }

    function post(requestBody) {
        try {
            var header = requestBody.header || {}

            // isDynamic: true deliberately - this makes field entry behave like a UI save (field
            // sourcing/derivation runs as each value is set), which is the whole point of using a
            // RESTlet instead of the REST record API: to get NetSuite's normal tax computation to run.
            var salesOrder = record.create({
                type: record.Type.SALES_ORDER,
                isDynamic: true
            })

            setBodyFields(salesOrder, header.valueFields, header.textFields, header.dateFields)
            setAddress(salesOrder, 'shippingaddress', requestBody.shippingAddress)
            setAddress(salesOrder, 'billingaddress', requestBody.billingAddress)
            setItemLines(salesOrder, requestBody.items)

            var internalId = salesOrder.save({ enableSourcing: true, ignoreMandatoryFields: false })

            return {
                success: true,
                internalId: internalId
            }
        } catch (e) {
            log.error({ title: 'createSalesOrderRestlet error', details: e })
            log.error({ title: 'createSalesOrderRestlet failed requestBody', details: JSON.stringify(requestBody) })
            return {
                success: false,
                error: e.message || e.toString(),
                name: e.name
            }
        }
    }

    return {
        post: post
    }
})
