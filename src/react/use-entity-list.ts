import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ListEntitiesOptions } from '../resources/entities';
import type { Entity, PaginatedEntities } from '../types';
import { useLunnoaClient } from './auth';

export type EntityListStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UseEntityListOptions = ListEntitiesOptions & {
  /**
   * When false, skips fetching until set true. Defaults to true.
   */
  enabled?: boolean;
};

export interface UseEntityListResult {
  data: Entity[];
  pagination: PaginatedEntities['pagination'] | null;
  page: number;
  setPage: (page: number) => void;
  status: EntityListStatus;
  error: Error | null;
  refresh: () => Promise<PaginatedEntities | null>;
  /** Merges into list filters and resets to page 1. */
  setSearch: (search: string | undefined) => void;
  /** Merges into list filters and resets to page 1. */
  setState: (state: string | undefined) => void;
  /** Current effective list options (including page). */
  options: ListEntitiesOptions;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function omitListControlFields(
  options: UseEntityListOptions,
): Omit<ListEntitiesOptions, 'page'> {
  const {
    page: _page,
    enabled: _enabled,
    ...rest
  } = options;
  return rest;
}

/**
 * Paginated entity list for tables and pickers.
 *
 * ```tsx
 * const { data, page, setPage, setSearch, status } = useEntityList({
 *   objectTypeSlug: 'invoice',
 *   expansion: ['attributes'],
 *   pageSize: 25,
 * });
 * ```
 */
export function useEntityList(
  initialOptions: UseEntityListOptions,
): UseEntityListResult {
  const client = useLunnoaClient();
  const enabled = initialOptions.enabled !== false;

  const [page, setPageState] = useState(initialOptions.page ?? 1);
  const [filters, setFilters] = useState<Omit<ListEntitiesOptions, 'page'>>(
    () => omitListControlFields(initialOptions),
  );
  const [data, setData] = useState<Entity[]>([]);
  const [pagination, setPagination] = useState<
    PaginatedEntities['pagination'] | null
  >(null);
  const [status, setStatus] = useState<EntityListStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const clientRef = useRef(client);
  clientRef.current = client;

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        objectTypeId: initialOptions.objectTypeId,
        objectTypeSlug: initialOptions.objectTypeSlug,
        state: initialOptions.state,
        states: initialOptions.states,
        ownerId: initialOptions.ownerId,
        search: initialOptions.search,
        sortBy: initialOptions.sortBy,
        sortOrder: initialOptions.sortOrder,
        pageSize: initialOptions.pageSize,
        expansion: initialOptions.expansion,
      }),
    [
      initialOptions.objectTypeId,
      initialOptions.objectTypeSlug,
      initialOptions.state,
      initialOptions.states,
      initialOptions.ownerId,
      initialOptions.search,
      initialOptions.sortBy,
      initialOptions.sortOrder,
      initialOptions.pageSize,
      initialOptions.expansion,
    ],
  );

  useEffect(() => {
    setFilters(omitListControlFields(initialOptions));
    setPageState(initialOptions.page ?? 1);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when caller options identity changes

  const options = useMemo<ListEntitiesOptions>(
    () => ({ ...filters, page }),
    [filters, page],
  );

  const refresh = useCallback(async (): Promise<PaginatedEntities | null> => {
    if (!enabled) {
      setStatus('idle');
      return null;
    }
    setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const result = await clientRef.current.entities.list(options);
      setData(result.data ?? []);
      setPagination(result.pagination ?? null);
      setError(null);
      setStatus('ready');
      return result;
    } catch (err) {
      const next = toError(err);
      setError(next);
      setStatus('error');
      throw next;
    }
  }, [enabled, options]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch {
        // Error state already set.
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setPage = useCallback((next: number) => {
    setPageState(Math.max(1, next));
  }, []);

  const setSearch = useCallback((search: string | undefined) => {
    setFilters((prev) => ({ ...prev, search }));
    setPageState(1);
  }, []);

  const setState = useCallback((state: string | undefined) => {
    setFilters((prev) => ({ ...prev, state }));
    setPageState(1);
  }, []);

  return {
    data,
    pagination,
    page,
    setPage,
    status,
    error,
    refresh,
    setSearch,
    setState,
    options,
  };
}
