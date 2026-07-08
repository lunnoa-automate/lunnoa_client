import { describe, expect, it } from 'vitest';

import { iterateOffset, iteratePages } from '../src/core/pagination';

describe('iteratePages', () => {
  it('walks every page lazily', async () => {
    const pages = [
      { data: [1, 2], pagination: { page: 1, pageSize: 2, totalCount: 5, totalPages: 3 } },
      { data: [3, 4], pagination: { page: 2, pageSize: 2, totalCount: 5, totalPages: 3 } },
      { data: [5], pagination: { page: 3, pageSize: 2, totalCount: 5, totalPages: 3 } },
    ];
    const requestedPages: number[] = [];
    const items: number[] = [];
    for await (const item of iteratePages<number>(async (page) => {
      requestedPages.push(page);
      return pages[page - 1];
    })) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(requestedPages).toEqual([1, 2, 3]);
  });

  it('stops immediately on an empty result', async () => {
    const items: number[] = [];
    for await (const item of iteratePages<number>(async () => ({
      data: [],
      pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
    }))) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });

  it('does not fetch further pages when the consumer stops early', async () => {
    const requestedPages: number[] = [];
    const iterator = iteratePages<number>(async (page) => {
      requestedPages.push(page);
      return {
        data: [page * 10, page * 10 + 1],
        pagination: { page, pageSize: 2, totalCount: 100, totalPages: 50 },
      };
    });
    const first = await iterator.next();
    expect(first.value).toBe(10);
    await iterator.return();
    expect(requestedPages).toEqual([1]);
  });
});

describe('iterateOffset', () => {
  it('walks batches using the total count', async () => {
    const all = ['a', 'b', 'c', 'd', 'e'];
    const offsets: number[] = [];
    const items: string[] = [];
    for await (const item of iterateOffset<string>(async (offset) => {
      offsets.push(offset);
      return {
        items: all.slice(offset, offset + 2),
        pagination: { total: all.length, limit: 2, offset },
      };
    })) {
      items.push(item);
    }
    expect(items).toEqual(all);
    expect(offsets).toEqual([0, 2, 4]);
  });

  it('respects an explicit hasMore=false', async () => {
    const items: string[] = [];
    for await (const item of iterateOffset<string>(async () => ({
      items: ['only'],
      pagination: { total: 999, limit: 50, offset: 0, hasMore: false },
    }))) {
      items.push(item);
    }
    expect(items).toEqual(['only']);
  });

  it('terminates on an empty batch even when total is wrong', async () => {
    const items: string[] = [];
    for await (const item of iterateOffset<string>(async () => ({
      items: [],
      pagination: { total: 10, limit: 2, offset: 0 },
    }))) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });
});
