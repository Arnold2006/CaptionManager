// Promise pool: run fn over items with at most `limit` in flight.
// isCancelled() is polled between items; results preserve input order.
export async function mapLimit(items, limit, fn, isCancelled) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      if (isCancelled && isCancelled()) return;
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
