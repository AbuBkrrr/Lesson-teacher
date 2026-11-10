import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Paged list loader for admin tables. `fetcher(page)` must resolve to
 * { <rows>, total, page }. Page 1 replaces, later pages append. Stale responses
 * (from a previous filter) are dropped via a sequence counter.
 */
export default function usePagedList(fetcher, rowsKey, deps) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback((n = 1) => {
    const mine = ++seq.current;
    return fetchRef.current(n).then((d) => {
      if (mine !== seq.current) return;
      setRows((prev) => (n === 1 || !prev ? d[rowsKey] : [...prev, ...d[rowsKey]]));
      setTotal(d.total);
      setPage(n);
      setError(null);
    }).catch((e) => { if (mine === seq.current) setError(e.message); });
  }, [rowsKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [load, ...deps]);

  const loadMore = async () => { setLoadingMore(true); await load(page + 1); setLoadingMore(false); };
  const patchRow = (id, patch, key = 'id') => setRows((r) => (r || []).map((x) => (x[key] === id ? { ...x, ...patch } : x)));
  return { rows, total, error, setError, loadMore, loadingMore, reload: () => load(1), patchRow, hasMore: !!rows && rows.length < total };
}
