/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/query'], (query) => {

  // Normalize a datetime string into "YYYY-MM-DD HH:MM:SS"
  // Accepts:
  //  - "2026-02-10 12:30:45"
  //  - "2026-02-10T12:30:45"
  //  - "2026-02-10T12:30:45Z"
  const normalizeDateTime = (s) => {
    if (!s || typeof s !== 'string') return null;

    let v = s.trim();
    // Convert ISO "T" to space
    v = v.replace('T', ' ');
    // Remove trailing 'Z' (NetSuite account timezone handling varies; pass in account-local time ideally)
    v = v.replace(/Z$/, '');

    // If user passed only minutes "YYYY-MM-DD HH:MM", add seconds
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) v += ':00';

    // Basic validation
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
      throw new Error(
        "Invalid datetime format. Use 'YYYY-MM-DD HH:MM:SS' (or ISO 'YYYY-MM-DDTHH:MM:SSZ'). " +
        "Received: " + s
      );
    }

    return v;
  };

  /**
   * GET
   * /app/site/hosting/restlet.nl?script=###&deploy=1
   *   &from_datetime=2026-02-05%2000:00:00
   *   &to_datetime=2026-02-10%2023:59:59
   *   &limit=1000&offset=0
   */
  const get = (requestParams) => {
    const fromRaw = requestParams.from_datetime || requestParams.fromDateTime;
    const toRaw = requestParams.to_datetime || requestParams.toDateTime;

    const fromDT = normalizeDateTime(fromRaw);
    if (!fromDT) throw new Error("Missing required parameter: from_datetime");

    const toDT = toRaw ? normalizeDateTime(toRaw) : null;

    const limit = Math.min(parseInt(requestParams.limit || '1000', 10), 5000);
    const offset = parseInt(requestParams.offset || '0', 10);

    // Build WHERE with bound params (safe)
    let where = `
      WHERE t.type = 'ItemRcpt'
        AND src.type = 'RtnAuth'
        AND t.createddate >= TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS')
    `;
    const params = [fromDT];

    if (toDT) {
      where += `
        AND t.createddate <= TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS')
      `;
      params.push(toDT);
    }

    // Add pagination params
    params.push(offset, limit);

    const suiteql = `
      SELECT
        t.id,
        t.tranid,
        t.createddate,
        t.lastmodifieddate,
        t.trandate,
        tl.createdfrom,
        BUILTIN.DF(tl.createdfrom) AS createdfrom_display,
        src.tranid AS rma_tranid
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
       AND tl.mainline = 'T'
      INNER JOIN transaction src
        ON src.id = tl.createdfrom
      ${where}
      ORDER BY t.createddate ASC, t.id ASC
      OFFSET ?
      FETCH NEXT ? ROWS ONLY
    `;

    const resultSet = query.runSuiteQL({ query: suiteql, params });
    const rows = resultSet.asMappedResults();

    return {
      ok: true,
      from_datetime: fromDT,
      to_datetime: toDT,
      limit,
      offset,
      count: rows.length,
      data: rows
    };
  };

  /**
   * POST body example:
   * {
   *   "from_datetime": "2026-02-05 00:00:00",
   *   "to_datetime": "2026-02-10 23:59:59",
   *   "limit": 1000,
   *   "offset": 0
   * }
   */
  const post = (body) => {
    body = body || {};
    return get(body);
  };

  return { get, post };
});