/**
 * Optional ?page=&page_size= paging for list endpoints. Defaults keep each
 * endpoint's historical cap (so existing clients see the same first page);
 * callers pass page_size/page to walk further. Responses add
 * { page, page_size, total } next to the existing array key.
 */
function getPaging(req, { defaultSize = 200, maxSize = 200 } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(req.query.page_size, 10) || defaultSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

function pageMeta(p, total) {
  return { page: p.page, page_size: p.pageSize, total: Number(total) };
}

module.exports = { getPaging, pageMeta };
