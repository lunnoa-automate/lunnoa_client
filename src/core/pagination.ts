/** Pagination block returned by page-based list endpoints (entities). */
export interface PagePagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** Pagination block returned by offset-based list endpoints (queue items). */
export interface OffsetPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
}

/**
 * Iterates every item of a page-based (`page`/`pageSize`) paginated endpoint,
 * fetching pages lazily as the consumer advances.
 */
export async function* iteratePages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; pagination: PagePagination }>,
): AsyncGenerator<T, void, undefined> {
  let page = 1;
  while (true) {
    const { data, pagination } = await fetchPage(page);
    for (const item of data) {
      yield item;
    }
    if (page >= pagination.totalPages || data.length === 0) {
      return;
    }
    page += 1;
  }
}

/**
 * Iterates every item of an offset-based (`limit`/`offset`) paginated
 * endpoint, fetching batches lazily as the consumer advances.
 */
export async function* iterateOffset<T>(
  fetchBatch: (offset: number) => Promise<{ items: T[]; pagination: OffsetPagination }>,
): AsyncGenerator<T, void, undefined> {
  let offset = 0;
  while (true) {
    const { items, pagination } = await fetchBatch(offset);
    for (const item of items) {
      yield item;
    }
    offset += items.length;
    const exhausted =
      items.length === 0 ||
      (pagination.hasMore !== undefined
        ? !pagination.hasMore
        : offset >= pagination.total);
    if (exhausted) {
      return;
    }
  }
}
