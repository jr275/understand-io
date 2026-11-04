import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { hashKey } from "./rateStore";

/**
 * Where the AI allowances live: the daily question counters, the "one generation at a time" leases, the money set aside for running
 * requests and the ledger of what was spent. The database version is what production uses, so all of it survives restarts and is the same
 * for every instance. The in-memory version is the same behaviour for a process with no database (local work, previews) and for tests; it
 * is per process, which is why production fails closed when it cannot reach the database (see `aiAdmission.ts`).
 */

export interface Charge {
  micro: number;
  inputTokens: number;
  outputTokens: number;
  /** 1 when the request ended in a provider failure or a timeout, for the health check. */
  errors: 0 | 1;
}

export interface Totals {
  spentMicro: number;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Usage {
  day: Totals;
  month: Totals;
  /** Set aside for requests that are running now. */
  reservedMicro: number;
  lastHour: Pick<Totals, "requests" | "errors">;
}

export type ReserveResult = { ok: true } | { ok: false; reason: "daily" | "monthly" };

export interface AiStore {
  /** Counts one more use of `key` in the window `now` falls in, and answers the count so far. */
  quotaHit(key: string, windowMs: number, now: number): Promise<number>;
  /** Gives one use back (a request that was refused after being counted, or that failed before the provider charged anything). */
  quotaRefund(key: string, windowMs: number, now: number): Promise<void>;
  /**
   * Sets up to `n` uses of `key` aside in the window `now` falls in, without ever letting that window's count pass `cap`, and answers how many were
   * granted (0 to `n`). Atomic across instances: the total granted in one window cannot exceed `cap`, however many requests race for it and however
   * they are batched. A window that is already past `cap` (the operator lowered it) grants 0 and is left as it is.
   */
  quotaReserve(key: string, windowMs: number, now: number, n: number, cap: number): Promise<number>;
  /** Gives back `n` uses set aside by `quotaReserve` that were not used (the events were not stored). Never goes below zero. */
  quotaRelease(key: string, windowMs: number, now: number, n: number): Promise<void>;
  /** True when `key` was free (or its previous holder's lease had expired) and is now held by `token`. */
  acquireLease(key: string, token: string, ttlMs: number, now: number): Promise<boolean>;
  releaseLease(key: string, token: string): Promise<void>;
  /** Sets `amountMicro` aside if the day's and the month's budgets still have room for it on top of what is spent and what is already set aside. Atomic across instances. */
  reserve(id: string, amountMicro: number, limits: { dailyMicro: number; monthlyMicro: number }, ttlMs: number, now: number): Promise<ReserveResult>;
  /** Records what a request really cost and releases its reservation. */
  settle(id: string, charge: Charge, now: number): Promise<void>;
  usage(now: number): Promise<Usage>;
  /** Throws when the store cannot be reached. */
  ping(): Promise<void>;
  /** The size of the database in bytes, for the storage alert; null when the store has no such thing (memory) or cannot tell. */
  storageBytes?(): Promise<number | null>;
}

const periodOf = (now: number) => new Date(now).toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)
const emptyTotals = (): Totals => ({ spentMicro: 0, requests: 0, errors: 0, inputTokens: 0, outputTokens: 0 });
const windowStart = (now: number, windowMs: number) => Math.floor(now / windowMs) * windowMs;

/* ------------------------------------------------------------------ in memory */

export interface MemoryAiStore extends AiStore {
  clear(): void;
}

export function createMemoryAiStore(): MemoryAiStore {
  const quota = new Map<string, number>();
  const leases = new Map<string, { token: string; expiresAt: number }>();
  const reservations = new Map<string, { amount: number; expiresAt: number }>();
  const ledger = new Map<string, Totals>();

  const sum = (prefix: string): Totals => {
    const t = emptyTotals();
    for (const [period, row] of ledger)
      if (period.startsWith(prefix)) {
        t.spentMicro += row.spentMicro;
        t.requests += row.requests;
        t.errors += row.errors;
        t.inputTokens += row.inputTokens;
        t.outputTokens += row.outputTokens;
      }
    return t;
  };
  const reserved = (now: number) => {
    let n = 0;
    for (const r of reservations.values()) if (r.expiresAt > now) n += r.amount;
    return n;
  };

  return {
    async quotaHit(key, windowMs, now) {
      const k = `${key}@${windowStart(now, windowMs)}`;
      const n = (quota.get(k) ?? 0) + 1;
      quota.set(k, n);
      return n;
    },
    async quotaRefund(key, windowMs, now) {
      const k = `${key}@${windowStart(now, windowMs)}`;
      quota.set(k, Math.max(0, (quota.get(k) ?? 0) - 1));
    },
    async quotaReserve(key, windowMs, now, n, cap) {
      const k = `${key}@${windowStart(now, windowMs)}`;
      const have = quota.get(k) ?? 0;
      const granted = Math.max(0, Math.min(Math.floor(n), cap - have));
      if (granted > 0) quota.set(k, have + granted);
      return granted;
    },
    async quotaRelease(key, windowMs, now, n) {
      const k = `${key}@${windowStart(now, windowMs)}`;
      quota.set(k, Math.max(0, (quota.get(k) ?? 0) - Math.max(0, Math.floor(n))));
    },
    async acquireLease(key, token, ttlMs, now) {
      const held = leases.get(key);
      if (held && held.expiresAt >= now) return false;
      leases.set(key, { token, expiresAt: now + ttlMs });
      return true;
    },
    async releaseLease(key, token) {
      if (leases.get(key)?.token === token) leases.delete(key);
    },
    async reserve(id, amount, limits, ttlMs, now) {
      const held = reserved(now);
      if (sum(periodOf(now).slice(0, 10)).spentMicro + held + amount > limits.dailyMicro) return { ok: false, reason: "daily" };
      if (sum(periodOf(now).slice(0, 7)).spentMicro + held + amount > limits.monthlyMicro) return { ok: false, reason: "monthly" };
      reservations.set(id, { amount, expiresAt: now + ttlMs });
      return { ok: true };
    },
    async settle(id, charge, now) {
      const period = periodOf(now);
      const row = ledger.get(period) ?? emptyTotals();
      row.spentMicro += charge.micro;
      row.inputTokens += charge.inputTokens;
      row.outputTokens += charge.outputTokens;
      row.requests += 1;
      row.errors += charge.errors;
      ledger.set(period, row);
      reservations.delete(id);
    },
    async usage(now) {
      const hour = sum(periodOf(now));
      return { day: sum(periodOf(now).slice(0, 10)), month: sum(periodOf(now).slice(0, 7)), reservedMicro: reserved(now), lastHour: { requests: hour.requests, errors: hour.errors } };
    },
    async ping() {},
    async storageBytes() {
      return null;
    },
    clear() {
      quota.clear();
      leases.clear();
      reservations.clear();
      ledger.clear();
    },
  };
}

/* ------------------------------------------------------------------ in the database */

/** One number for every instance to take the same lock on, so two requests cannot both see the same remaining budget. */
const BUDGET_LOCK = 7_281_001;
const num = (v: unknown) => Number(v ?? 0);

export const databaseAiStore: AiStore = {
  async quotaHit(key, windowMs, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const ws = windowStart(now, windowMs);
    const rows = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_hits (key, window_start, count, expires_at)
      VALUES (${hashKey(key)}, ${ws}, 1, ${ws + 2 * windowMs})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_hits.count + 1
      RETURNING count`);
    return num(rows[0]?.count);
  },

  async quotaRefund(key, windowMs, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    await db.execute(sql`UPDATE rate_hits SET count = GREATEST(count - 1, 0) WHERE key = ${hashKey(key)} AND window_start = ${windowStart(now, windowMs)}`);
  },

  async quotaReserve(key, windowMs, now, n, cap) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const want = Math.floor(n);
    if (!(want > 0) || !(cap > 0)) return 0;
    const ws = windowStart(now, windowMs);
    const k = hashKey(key);
    // Make sure the window's row exists (count 0). Idempotent; a row left behind by a crash between the two statements is harmless.
    await db.execute(sql`INSERT INTO rate_hits (key, window_start, count, expires_at) VALUES (${k}, ${ws}, 0, ${ws + 2 * windowMs}) ON CONFLICT (key, window_start) DO NOTHING`);
    // One statement: the sub-select locks the row, so concurrent reservations (from any instance) take turns and each sees the count the previous one left
    // (READ COMMITTED re-reads a locked row). The new count never passes `cap`, and never goes down if `cap` was lowered: the grant is the difference.
    const rows = await db.execute<{ granted: number }>(sql`
      UPDATE rate_hits r SET count = GREATEST(r.count, LEAST(r.count + ${want}, ${cap}))
      FROM (SELECT key, window_start, count AS before FROM rate_hits WHERE key = ${k} AND window_start = ${ws} FOR UPDATE) o
      WHERE r.key = o.key AND r.window_start = o.window_start
      RETURNING r.count - o.before AS granted`);
    return num(rows[0]?.granted);
  },

  async quotaRelease(key, windowMs, now, n) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const back = Math.max(0, Math.floor(n));
    if (back === 0) return;
    await db.execute(sql`UPDATE rate_hits SET count = GREATEST(count - ${back}, 0) WHERE key = ${hashKey(key)} AND window_start = ${windowStart(now, windowMs)}`);
  },

  async acquireLease(key, token, ttlMs, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const rows = await db.execute(sql`
      INSERT INTO ai_leases (key, token, expires_at) VALUES (${hashKey(key)}, ${token}, ${now + ttlMs})
      ON CONFLICT (key) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
      WHERE ai_leases.expires_at < ${now}
      RETURNING token`);
    return rows.length === 1;
  },

  async releaseLease(key, token) {
    const db = getDb();
    if (!db) throw new Error("no database");
    await db.execute(sql`DELETE FROM ai_leases WHERE key = ${hashKey(key)} AND token = ${token}`);
  },

  async reserve(id, amount, limits, ttlMs, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const day = periodOf(now).slice(0, 10);
    const month = periodOf(now).slice(0, 7);
    return db.transaction(async (tx): Promise<ReserveResult> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUDGET_LOCK})`);
      await tx.execute(sql`DELETE FROM ai_reservations WHERE expires_at < ${now - 3_600_000}`);
      const spent = await tx.execute<{ day_spent: string; month_spent: string }>(sql`
        SELECT COALESCE(SUM(spent_micro) FILTER (WHERE period LIKE ${day + "%"}), 0)::text AS day_spent,
               COALESCE(SUM(spent_micro), 0)::text AS month_spent
        FROM ai_ledger WHERE period LIKE ${month + "%"}`);
      const held = await tx.execute<{ held: string }>(sql`SELECT COALESCE(SUM(amount_micro), 0)::text AS held FROM ai_reservations WHERE expires_at > ${now}`);
      const inFlight = num(held[0]?.held);
      if (num(spent[0]?.day_spent) + inFlight + amount > limits.dailyMicro) return { ok: false, reason: "daily" };
      if (num(spent[0]?.month_spent) + inFlight + amount > limits.monthlyMicro) return { ok: false, reason: "monthly" };
      await tx.execute(sql`INSERT INTO ai_reservations (id, amount_micro, expires_at) VALUES (${id}, ${amount}, ${now + ttlMs})`);
      return { ok: true };
    });
  },

  async settle(id, charge, now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO ai_ledger (period, spent_micro, input_tokens, output_tokens, requests, errors)
        VALUES (${periodOf(now)}, ${charge.micro}, ${charge.inputTokens}, ${charge.outputTokens}, 1, ${charge.errors})
        ON CONFLICT (period) DO UPDATE SET
          spent_micro = ai_ledger.spent_micro + EXCLUDED.spent_micro,
          input_tokens = ai_ledger.input_tokens + EXCLUDED.input_tokens,
          output_tokens = ai_ledger.output_tokens + EXCLUDED.output_tokens,
          requests = ai_ledger.requests + 1,
          errors = ai_ledger.errors + EXCLUDED.errors`);
      await tx.execute(sql`DELETE FROM ai_reservations WHERE id = ${id}`);
    });
  },

  async usage(now) {
    const db = getDb();
    if (!db) throw new Error("no database");
    const period = periodOf(now);
    type Row = { spent: string; requests: string; errors: string; in_tokens: string; out_tokens: string };
    const totals = async (prefix: string): Promise<Totals> => {
      const r = await db.execute<Row>(sql`
        SELECT COALESCE(SUM(spent_micro), 0)::text AS spent, COALESCE(SUM(requests), 0)::text AS requests, COALESCE(SUM(errors), 0)::text AS errors,
               COALESCE(SUM(input_tokens), 0)::text AS in_tokens, COALESCE(SUM(output_tokens), 0)::text AS out_tokens
        FROM ai_ledger WHERE period LIKE ${prefix + "%"}`);
      return { spentMicro: num(r[0]?.spent), requests: num(r[0]?.requests), errors: num(r[0]?.errors), inputTokens: num(r[0]?.in_tokens), outputTokens: num(r[0]?.out_tokens) };
    };
    const held = await db.execute<{ held: string }>(sql`SELECT COALESCE(SUM(amount_micro), 0)::text AS held FROM ai_reservations WHERE expires_at > ${now}`);
    const hour = await totals(period);
    return { day: await totals(period.slice(0, 10)), month: await totals(period.slice(0, 7)), reservedMicro: num(held[0]?.held), lastHour: { requests: hour.requests, errors: hour.errors } };
  },

  async ping() {
    const db = getDb();
    if (!db) throw new Error("no database");
    await db.execute(sql`SELECT 1`);
  },

  async storageBytes() {
    const db = getDb();
    if (!db) return null;
    const rows = await db.execute<{ size: string }>(sql`SELECT pg_database_size(current_database())::text AS size`);
    const n = Number(rows[0]?.size);
    return Number.isFinite(n) ? n : null;
  },
};

/* ------------------------------------------------------------------ which one is in use */

const processStore = createMemoryAiStore();
let override: AiStore | undefined;

/** Test seam: use this store instead of the default (`undefined` restores it). */
export function setAiStore(store: AiStore | undefined) {
  override = store;
}

/** True when allowances are kept in the database (production); false when each process keeps its own (no `DATABASE_URL`). */
export const sharedStoreConfigured = () => override === undefined && !!process.env.DATABASE_URL;

export function aiStore(): AiStore {
  if (override) return override;
  return process.env.DATABASE_URL ? databaseAiStore : processStore;
}

/** Test hook: forget everything the in-process store holds. */
export function resetProcessAiStore() {
  processStore.clear();
}
