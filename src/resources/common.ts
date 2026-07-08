import type { QueryValue } from '../core/http';

/**
 * Standard list-query conventions shared by most Lunnoa list endpoints:
 *
 * - `expansion` — comma-separated field names to include beyond the defaults
 * - `filterBy` — comma-separated `key:value` pairs
 * - `includeType` — comma-separated inclusion flags (e.g. `all`, `internal`)
 */
export interface ListQueryOptions {
  expansion?: string | string[];
  filterBy?: string | Record<string, string>;
  includeType?: string | string[];
}

export function serializeListQuery(
  options: ListQueryOptions = {},
): Record<string, QueryValue> {
  return {
    expansion: serializeCsv(options.expansion),
    filterBy: serializeFilterBy(options.filterBy),
    includeType: serializeCsv(options.includeType),
  };
}

export function serializeCsv(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value.join(',') : value;
}

export function serializeFilterBy(
  value: string | Record<string, string> | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return Object.entries(value)
    .map(([key, filterValue]) => `${key}:${filterValue}`)
    .join(',');
}
