import api from '@forge/api';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request counter + stage timer for the resolver (specs/06-timeline-performance,
 * "Instrumentation"). Every Jira call in `jira.ts` goes through `asUser()` /
 * `asApp()` below instead of `api.asUser()` / `api.asApp()`, so each resolver
 * invocation can report how many requests it made per endpoint and how long
 * each stage took. The trace lives in AsyncLocalStorage, so concurrent
 * invocations in one container never mix their logs. Outside a trace, the
 * wrappers are plain pass-throughs.
 */

type RequestJira = ReturnType<typeof api.asApp>['requestJira'];
interface Requester {
  requestJira: RequestJira;
}
type Principal = 'user' | 'app';

export interface RequestRecord {
  as: Principal;
  /** normalized `METHOD /path` (ids → `{id}`; JQL searches tagged by kind) */
  endpoint: string;
  /** ms since the trace started */
  startMs: number;
  durationMs: number;
  /** HTTP status, or null when the request threw */
  status: number | null;
}

export interface StageRecord {
  name: string;
  /** ms since the trace started */
  startMs: number;
  durationMs: number;
}

export interface Trace {
  label: string;
  t0: number;
  requests: RequestRecord[];
  stages: StageRecord[];
  durationMs: number;
}

export interface TraceSummary {
  label: string;
  durationMs: number;
  totalRequests: number;
  /** request count per normalized endpoint, sorted by count descending */
  byEndpoint: Record<string, number>;
  /** `{ startMs, durationMs }` per stage, in start order */
  stages: Record<string, { startMs: number; durationMs: number }>;
}

const current = new AsyncLocalStorage<Trace>();

const now = (): number => performance.now();

/** Default sink: one compact line per resolver call, visible in the Forge logs. */
let sink: (trace: Trace) => void = (trace) => {
  console.log(`[perf] ${JSON.stringify(summarizeTrace(trace))}`);
};

/** Replace where finished traces go (tests capture them). Returns the previous sink. */
export function setTraceSink(next: (trace: Trace) => void): (trace: Trace) => void {
  const prev = sink;
  sink = next;
  return prev;
}

/** Run `fn` inside a fresh trace, then hand the finished trace to the sink. */
export async function traced<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const trace: Trace = { label, t0: now(), requests: [], stages: [], durationMs: 0 };
  try {
    return await current.run(trace, fn);
  } finally {
    trace.durationMs = now() - trace.t0;
    sink(trace);
  }
}

/** Time one stage of the current trace. A no-op wrapper outside a trace. */
export async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const trace = current.getStore();
  if (!trace) return fn();
  const start = now();
  try {
    return await fn();
  } finally {
    trace.stages.push({ name, startMs: start - trace.t0, durationMs: now() - start });
  }
}

function routePath(route: unknown): string {
  if (typeof route === 'string') return route;
  const value = (route as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : String(route);
}

function jqlKind(jql: string): string {
  const q = jql.trim();
  if (/^id\s+in\b/i.test(q)) return 'id in';
  if (/^parent\s+in\b/i.test(q)) return 'parent in';
  if (/^parent\s*=/i.test(q)) return 'parent =';
  if (/^project\s*=/i.test(q)) return 'project';
  if (/issue\.property\[kpi-assignments\]/i.test(q)) return 'kpi-assignments index';
  return 'other';
}

/**
 * Normalize a request to a stable endpoint label so counts group by kind:
 * numeric ids / issue keys → `{id}`, `customfield_NNN` → `{field}`, and JQL
 * searches tagged with the shape of their query (`[parent in]`, `[id in]`, …).
 */
export function endpointOf(method: string, route: unknown): string {
  const raw = routePath(route);
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/');
  const path = segments
    .map((seg, i) =>
      segments[i - 1] === 'api'
        ? seg // API version (`/rest/api/3`)
        : /^\d+$/.test(seg) || /^[A-Z][A-Z0-9_]*-\d+$/.test(seg)
          ? '{id}'
          : /^customfield_\d+$/.test(seg)
            ? '{field}'
            : seg,
    )
    .join('/');
  let label = `${method.toUpperCase()} ${path}`;
  if (path.endsWith('/search/jql')) {
    const jql = new URLSearchParams(queryPart).get('jql') ?? '';
    label += ` [${jqlKind(jql)}]`;
  }
  return label;
}

function wrap(as: Principal, get: () => Requester): { requestJira: RequestJira } {
  const requestJira: RequestJira = async (route, init) => {
    const trace = current.getStore();
    if (!trace) return get().requestJira(route, init);
    const start = now();
    const record: RequestRecord = {
      as,
      endpoint: endpointOf(init?.method ?? 'GET', route),
      startMs: start - trace.t0,
      durationMs: 0,
      status: null,
    };
    try {
      const res = await get().requestJira(route, init);
      record.status = res.status;
      return res;
    } finally {
      record.durationMs = now() - start;
      trace.requests.push(record);
    }
  };
  return { requestJira };
}

/** Counted drop-in for `api.asUser()`. */
export const asUser = (): { requestJira: RequestJira } => wrap('user', () => api.asUser());
/** Counted drop-in for `api.asApp()`. */
export const asApp = (): { requestJira: RequestJira } => wrap('app', () => api.asApp());

export function summarizeTrace(trace: Trace): TraceSummary {
  const counts = new Map<string, number>();
  for (const r of trace.requests) counts.set(r.endpoint, (counts.get(r.endpoint) ?? 0) + 1);
  const byEndpoint = Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
  const stages: TraceSummary['stages'] = {};
  for (const s of [...trace.stages].sort((a, b) => a.startMs - b.startMs)) {
    stages[s.name] = { startMs: Math.round(s.startMs), durationMs: Math.round(s.durationMs) };
  }
  return {
    label: trace.label,
    durationMs: Math.round(trace.durationMs),
    totalRequests: trace.requests.length,
    byEndpoint,
    stages,
  };
}
