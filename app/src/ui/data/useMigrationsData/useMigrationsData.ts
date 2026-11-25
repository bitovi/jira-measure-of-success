import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@ui/bridge.js';
import { nextMigrationToRun, type MigrationDto, type MigrationRecord, type MigrationsData } from '@domain/index.js';

/**
 * Settings → Upgrade data (spec 11 · 04 Step 6), on 02's resolvers. The
 * resolver calls are an object so stories can run against an in-memory set
 * (`createMockMigrations`).
 */
export interface MigrationsApi {
  getMigrations(): Promise<MigrationsData>;
  runMigrationBatch(id: string): Promise<MigrationRecord>;
  retryMigration(id: string): Promise<MigrationRecord>;
}

export const bridgeMigrationsApi: MigrationsApi = {
  getMigrations: () => call('getMigrations'),
  runMigrationBatch: (id) => call('runMigrationBatch', { id }),
  retryMigration: (id) => call('retryMigration', { id }),
};

export interface MigrationsController {
  /** null while loading */
  migrations: MigrationDto[] | null;
  /** the list couldn't be loaded */
  error: string | null;
  /** why the last run stopped early */
  runError: string | null;
  /** `pausing`: Pause was pressed; the batch in flight finishes first */
  phase: 'idle' | 'running' | 'pausing';
  /** the migration whose batches are running */
  current: string | null;
  /** run every pending migration in order, batch by batch, until done or paused */
  upgrade(): void;
  pause(): void;
  /** start a failed migration again, then carry on upgrading */
  retry(id: string): Promise<void>;
  /** re-read the list (e.g. after the KPI fields are chosen, 05's migration applies) */
  refresh(): void;
}

export type UseMigrations = () => MigrationsController;

const messageOf = (e: unknown): string => String((e as Error)?.message ?? e);

export function useMigrationsData(api: MigrationsApi = bridgeMigrationsApi): MigrationsController {
  const [migrations, setMigrations] = useState<MigrationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [phase, setPhase] = useState<MigrationsController['phase']>('idle');
  const [current, setCurrent] = useState<string | null>(null);
  const alive = useRef(true);
  const running = useRef(false);
  const pauseRequested = useRef(false);

  const refresh = useCallback(async (): Promise<MigrationDto[]> => {
    const { migrations: list } = await api.getMigrations();
    if (alive.current) setMigrations(list);
    return list;
  }, [api]);

  useEffect(() => {
    alive.current = true;
    refresh().catch((e: unknown) => alive.current && setError(messageOf(e)));
    return () => {
      alive.current = false;
      pauseRequested.current = true;
    };
  }, [refresh]);

  const upgrade = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    pauseRequested.current = false;
    setPhase('running');
    setRunError(null);
    const tried = new Set<string>();
    try {
      let list = await refresh();
      for (;;) {
        const next = nextMigrationToRun(list, tried);
        if (!next || pauseRequested.current) break;
        tried.add(next.id);
        setCurrent(next.id);
        let record: MigrationRecord;
        do {
          record = await api.runMigrationBatch(next.id);
          const saved = record;
          if (alive.current) setMigrations((ms) => ms?.map((m) => (m.id === saved.id ? { ...m, record: saved } : m)) ?? ms);
        } while (record.state === 'running' && !pauseRequested.current);
        // Finishing one can unblock the next (and its counts change), so re-read the list.
        list = await refresh();
        if (record.state === 'running') tried.delete(next.id);
      }
    } catch (e) {
      if (alive.current) setRunError(messageOf(e));
      await refresh().catch(() => undefined);
    } finally {
      running.current = false;
      if (alive.current) {
        setCurrent(null);
        setPhase('idle');
      }
    }
  }, [api, refresh]);

  const pause = useCallback(() => {
    if (!running.current) return;
    pauseRequested.current = true;
    setPhase('pausing');
  }, []);

  const retry = useCallback(
    async (id: string) => {
      setRunError(null);
      try {
        await api.retryMigration(id);
      } catch (e) {
        setRunError(messageOf(e));
        return;
      }
      await upgrade();
    },
    [api, upgrade],
  );

  return {
    migrations,
    error,
    runError,
    phase,
    current,
    upgrade: () => void upgrade(),
    pause,
    retry,
    refresh: () => {
      if (!running.current) void refresh().catch((e: unknown) => alive.current && setError(messageOf(e)));
    },
  };
}
