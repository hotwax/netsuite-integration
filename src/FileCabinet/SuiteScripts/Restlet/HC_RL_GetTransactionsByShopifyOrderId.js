/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @description Retrieves a list of all transactions associated with a given Shopify Order ID.
 */
define(['N/query'], (query) => {

  /**
   * GET
   * /app/site/hosting/restlet.nl?script=###&deploy=1&shopify_order_id=12345
   */
  const get = (requestParams) => {
    const shopifyOrderId = requestParams.shopify_order_id || requestParams.shopifyOrderId;

    if (!shopifyOrderId) {
      throw new Error("Missing required parameter: shopify_order_id");
    }

    const suiteql = `
      SELECT
        t.id,
        t.tranid,
        t.type,
        BUILTIN.DF(t.type) AS type_display,
        t.createddate,
        t.lastmodifieddate,
        t.trandate,
        t.status,
        BUILTIN.DF(t.status) AS status_display,
        t.entity,
        BUILTIN.DF(t.entity) AS entity_display,
        t.custbody_hc_shopify_order_id
      FROM transaction t
      WHERE t.custbody_hc_shopify_order_id = ?
      ORDER BY t.createddate ASC, t.id ASC
    `;

    const params = [shopifyOrderId];

    const resultSet = query.runSuiteQL({ query: suiteql, params });
    const rows = resultSet.asMappedResults();

    return {
      ok: true,
      shopify_order_id: shopifyOrderId,
      count: rows.length,
      data: rows
    };
  };

  /**
   * POST body example:
   * {
   *   "shopify_order_id": "12345"
   * }
   */
  const post = (body) => {
    body = body || {};
    return get(body);
  };

  return { get, post };
});
