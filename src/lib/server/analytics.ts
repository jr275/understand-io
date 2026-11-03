import { createHash } from "node:crypto";
import { lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { analyticsEvents } from "@/lib/db/schema";
import { CLIENT_EVENTS, parseEvent, routePattern, type EventName } from "@/lib/analytics/events";
import { channelOf, cleanAttribution, type Attribution } from "@/lib/analytics/attribution";
import { aiStore } from "./aiStore";
import { READER_COOKIE, pseudonym, verifyReaderCookie } from "./reader";
import { SlidingWindowLimiter, clientIp } from "./rateLimit";

/**
 * The collector behind `POST /api/events` and the server-side `recordServerEvent`. Three modes, set by the operator with `GLOSS_ANALYTICS`:
 *
 *   off        (the default) nothing is recorded and nothing is stored; the endpoint answers 204 and says so.
 *   daily      events are recorded against a hash that changes every day (address + browser + UTC day + the server's secret). It is a
 *              pseudonym, not anonymous data: within one day it singles out one browser, and whoever holds the secret could recompute it
 *              for a known address and browser. No cookie, no storage on the device, and it cannot follow a person from one day to the
 *              next. Counts only: no retention, no WAU/MAU.
 *   full       events are recorded against a stable pseudonym of the reader (an HMAC of the reader id, so the table holds no reader id) and
 *              first-touch attribution is kept in the tab's sessionStorage. Needed for retention, WAU/MAU and the funnel. The owner decides
 *              when this is switched on (consent wording, `docs/product/analytics.md`).
 *
 * In every mode a browser that sends Do Not Track or Global Privacy Control is not recorded. Nothing a reader reads or writes is in an event
 * (see `lib/analytics/events.ts`); a malformed or over-rich event is dropped whole.
 */
export type AnalyticsMode = "off" | "daily" | "full";

export function analyticsMode(): AnalyticsMode {
  const v = process.env.GLOSS_ANALYTICS?.trim().toLowerCase();
  return v === "daily" || v === "full" ? v : "off"; // anything else, including a mode that does not exist, is off
}

/**
 * What is actually in force. Every identifier analytics makes is a keyed hash, and in production the key is `GLOSS_COOKIE_SECRET`, which the
 * server refuses to use when it is missing, short or the example value. So when the key is not usable, analytics is off: nothing is recorded, and
 * nothing throws (the collector answers 204, the sign-in callback goes on). It never falls back to a weaker key or to unkeyed hashing.
 */
let lastKeyWarning = 0;
export function effectiveMode(): AnalyticsMode {
  const mode = analyticsMode();
  if (mode === "off") return mode;
  try {
    pseudonym("probe", "x");
    return mode;
  } catch {
    if (Date.now() - lastKeyWarning > 60_000) {
      lastKeyWarning = Date.now();
      console.warn("[analytics] switched off: the cookie secret is missing or too weak to key the identifiers (the secret itself is never logged)");
    }
    return "off";
  }
}

const DAY_MS = 86_400_000;
const whole = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
/** Events kept per UTC day in total. A cap protects the database (Neon Free is 1 GB): past it, events are dropped, not queued. */
const dailyCap = () => whole("GLOSS_ANALYTICS_DAILY_CAP", 5000);
const retentionDays = () => whole("GLOSS_ANALYTICS_RETENTION_DAYS", 120);

export interface StoredEvent {
  at: number;
  event: EventName;
  actor: string;
  actorKind: "reader" | "daily";
  route: string | null;
  props: Record<string, unknown>;
  channel: string | null;
  campaign: string | null;
  ref: string | null;
}

export interface AnalyticsSink {
  insert(rows: StoredEvent[]): Promise<void>;
}

const MEMORY_MAX = 2000;
const memory: StoredEvent[] = [];
const memorySink: AnalyticsSink = {
  async insert(rows) {
    memory.push(...rows);
    if (memory.length > MEMORY_MAX) memory.splice(0, memory.length - MEMORY_MAX);
  },
};

/** One in this many inserts also deletes what is past retention. */
const PRUNE_ONE_IN = 200;

/** Deletes events past retention (`GLOSS_ANALYTICS_RETENTION_DAYS`, default 120) and answers how many went. Also runs now and then by itself, after an insert. */
export async function pruneAnalytics(now: number = Date.now()): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  return (await db.delete(analyticsEvents).where(lt(analyticsEvents.at, now - retentionDays() * DAY_MS)).returning({ id: analyticsEvents.id })).length;
}

const databaseSink: AnalyticsSink = {
  async insert(rows) {
    const db = getDb();
    if (!db) throw new Error("no database");
    await db.insert(analyticsEvents).values(rows);
    if (Math.random() * PRUNE_ONE_IN < 1) void pruneAnalytics().catch(() => {});
  },
};

let override: AnalyticsSink | undefined;
/** Test seam. */
export function setAnalyticsSink(s: AnalyticsSink | undefined) {
  override = s;
}
const sink = (): AnalyticsSink => override ?? (process.env.DATABASE_URL ? databaseSink : memorySink);
/** Test hook: what the in-process sink holds (used when there is no database). */
export const memoryEvents = () => memory.slice();
export const clearMemoryEvents = () => void (memory.length = 0);

/* ------------------------------------------------------------------ who */

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** The one-day visitor: address + browser + UTC day + the secret, hashed. It cannot be reversed and is different tomorrow. */
export function dailyActor(req: Request, now: number): string {
  const day = Math.floor(now / DAY_MS);
  const seed = `${clientIp(req)}|${(req.headers.get("user-agent") ?? "").slice(0, 200)}|${day}`;
  return pseudonym("daily", createHash("sha256").update(seed).digest("hex"));
}

export function identifyActor(req: Request, mode: AnalyticsMode, now: number): { actor: string; actorKind: "reader" | "daily" } {
  if (mode === "full") {
    const reader = verifyReaderCookie(cookieValue(req, READER_COOKIE));
    if (reader) return { actor: pseudonym("reader", reader), actorKind: "reader" };
  }
  return { actor: dailyActor(req, now), actorKind: "daily" };
}

/** True when the browser asked not to be measured (Do Not Track or Global Privacy Control). */
export const optedOut = (req: Request) => req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1";

/* ------------------------------------------------------------------ taking events in */

const limiter = new SlidingWindowLimiter(5000);
const PER_MINUTE = 120;
const MAX_BODY = 8 * 1024;
const MAX_BATCH = 10;

/** The longest a request waits for analytics to be stored. */
const STORE_MS = 1500;
const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);

const noContent = (mode: AnalyticsMode | "dropped") => new Response(null, { status: 204, headers: { "x-gloss-analytics": mode === "dropped" ? "off" : mode, "cache-control": "no-store" } });

async function underDailyCap(now: number): Promise<boolean> {
  try {
    return (await aiStore().quotaHit("analytics:events", DAY_MS, now)) <= dailyCap();
  } catch {
    return false; // when the counter cannot be read, record nothing: analytics must never add load to a struggling database
  }
}

export async function handleEvents(req: Request, now: number = Date.now()): Promise<Response> {
  const mode = effectiveMode();
  if (mode === "off" || optedOut(req)) return noContent("dropped");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "bad-request" }, { status: 400 }); // refused before it is read
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return Response.json({ error: "bad-request" }, { status: 400 });
  let body: { events?: unknown; attribution?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const who = identifyActor(req, mode, now);
  const attribution: Attribution | null = mode === "full" && body.attribution ? cleanAttribution(body.attribution) : null;
  const rows: StoredEvent[] = [];
  for (const item of list) {
    const e = item && typeof item === "object" ? (item as { event?: unknown; props?: unknown; path?: unknown }) : {};
    const parsed = parseEvent(e.event, e.props);
    if (!parsed || !CLIENT_EVENTS.includes(parsed.event)) continue;
    if (!limiter.hit(`a:${who.actor}`, PER_MINUTE, 60_000, now).ok) break; // one visitor, a minute: past this the rest is dropped
    const withAttribution = parsed.event === "landing_viewed" && attribution;
    rows.push({
      at: now,
      event: parsed.event,
      actor: who.actor,
      actorKind: who.actorKind,
      route: routePattern(typeof e.path === "string" ? e.path : undefined),
      props: parsed.props,
      channel: withAttribution ? channelOf(attribution) : null,
      campaign: withAttribution ? attribution.campaign : null,
      ref: withAttribution && attribution.ref ? pseudonym("ref", attribution.ref) : null, // never the code itself
    });
  }
  // Bounded: a slow database never holds this answer (the browser does not wait for it, but the function should not either).
  if (rows.length && (await underDailyCap(now))) await within(sink().insert(rows).catch(() => {}), STORE_MS);
  return noContent(mode);
}

/**
 * Records an event the browser cannot be trusted to report (a registration, a payment). Fire and forget: it never throws and never waits for
 * the database longer than the request that called it already does. `readerId` is the reader the event is about.
 */
export async function recordServerEvent(name: EventName, props: Record<string, unknown>, readerId: string, attribution?: Attribution | null, now: number = Date.now()): Promise<void> {
  const mode = effectiveMode();
  if (mode !== "full") return; // without a stable pseudonym there is nothing meaningful to say about one person's registration
  const parsed = parseEvent(name, props);
  if (!parsed || !(await underDailyCap(now))) return;
  // Bounded: this runs inside the sign-in callback, and analytics must never make signing in wait.
  await within(
    sink()
    .insert([
      {
        at: now,
        event: parsed.event,
        actor: pseudonym("reader", readerId),
        actorKind: "reader",
        route: null,
        props: parsed.props,
        channel: attribution ? channelOf(attribution) : null,
        campaign: attribution?.campaign ?? null,
        ref: attribution?.ref ? pseudonym("ref", attribution.ref) : null,
      },
    ])
    .catch(() => {}),
    STORE_MS,
  );
}

/** Test hook. */
export const resetAnalyticsLimits = () => limiter.clear();
