/**
 * The growth metrics, as pure functions over recorded events. No imports on purpose: `scripts/growth-report.mjs` runs this file with plain
 * Node, and the tests run it on synthetic events. Every number is a ratio or a count over the rows it is given; where a denominator is zero
 * the answer is `null` (unknown), never 0, so "no data yet" cannot be read as "nobody converted".
 *
 * Who is counted: an "actor" is a pseudonym (`actorKind: "reader"`, the same for one reader's browser or account over time) or, for visits
 * before any reader exists, a one-day hash (`"daily"`). Only reader actors can be followed over days; daily actors count visits only.
 */

export interface EventRow {
  event: string;
  actor: string;
  actorKind: "reader" | "daily";
  /** Milliseconds since the epoch, UTC. */
  at: number;
  props: Record<string, unknown>;
  /** Where the visit came from (`channelOf` in attribution.ts): set on `landing_viewed` and `account_registered`. */
  channel?: string | null;
}

export const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** The events that mean someone is using the product, not just visiting it. */
export const ACTIVE_EVENTS: readonly string[] = ["document_saved", "document_opened", "highlight_created", "ai_question_asked", "library_searched"];

/** A knowledge retrieval: coming back for something already kept (a text saved at least a day ago, or a search that found something). */
export function isRetrieval(e: { event: string; props: Record<string, unknown> }): boolean {
  if (e.event === "document_opened") return e.props.age !== "0d" && e.props.via !== "landing";
  if (e.event === "library_searched") return e.props.results !== "0";
  return false;
}

export const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const day = (t: number) => Math.floor(t / DAY);
const readers = (rows: EventRow[]) => rows.filter((r) => r.actorKind === "reader");
const inRange = (r: EventRow, from: number, to: number) => r.at >= from && r.at < to;
const isActive = (r: EventRow) => ACTIVE_EVENTS.includes(r.event);

/** Distinct reader actors with at least one active event in [from, to). */
export function activeActors(rows: EventRow[], from: number, to: number): Set<string> {
  const s = new Set<string>();
  for (const r of readers(rows)) if (isActive(r) && inRange(r, from, to)) s.add(r.actor);
  return s;
}

export function wauMau(rows: EventRow[], asOf: number) {
  const wau = activeActors(rows, asOf - WEEK, asOf).size;
  const mau = activeActors(rows, asOf - 30 * DAY, asOf).size;
  return { wau, mau, stickiness: ratio(wau, mau) };
}

/** First time each reader actor did something (any event) and first time they did `event`, optionally after a moment. */
const firstSeen = (rows: EventRow[]) => {
  const m = new Map<string, number>();
  for (const r of readers(rows)) m.set(r.actor, Math.min(m.get(r.actor) ?? Infinity, r.at));
  return m;
};
const firstOf = (rows: EventRow[], pick: (r: EventRow) => boolean) => {
  const m = new Map<string, number>();
  for (const r of readers(rows)) if (pick(r)) m.set(r.actor, Math.min(m.get(r.actor) ?? Infinity, r.at));
  return m;
};

/**
 * The funnel for [from, to). Visits are counted as visitor-days (a daily hash cannot be followed, so the first step is a ratio of counts).
 * Each later step is a cohort: of the readers who registered in the period, how many have saved a text by the end of it; of those whose first
 * save fell in the period, how many have come back for something kept.
 */
export function funnel(rows: EventRow[], from: number, to: number) {
  const visitorDays = new Set<string>();
  for (const r of rows) if (r.event === "landing_viewed" && inRange(r, from, to)) visitorDays.add(`${r.actor}:${day(r.at)}`);
  const registered = firstOf(rows, (r) => r.event === "account_registered");
  const registeredInPeriod = [...registered].filter(([, t]) => t >= from && t < to).map(([a]) => a);
  const firstSave = firstOf(rows, (r) => r.event === "document_saved");
  const firstRetrieval = (a: string) => {
    const saved = firstSave.get(a);
    if (saved === undefined) return undefined;
    return readers(rows).filter((r) => r.actor === a && r.at > saved && r.at < to && isRetrieval(r)).length > 0;
  };
  const savedAmongRegistered = registeredInPeriod.filter((a) => (firstSave.get(a) ?? Infinity) < to).length;
  const firstSavers = [...firstSave].filter(([, t]) => t >= from && t < to).map(([a]) => a);
  const retrieved = firstSavers.filter((a) => firstRetrieval(a)).length;
  return {
    visits: visitorDays.size,
    registrations: registeredInPeriod.length,
    firstSaves: firstSavers.length,
    firstRetrievals: retrieved,
    visitToRegistration: ratio(registeredInPeriod.length, visitorDays.size),
    registrationToFirstSave: ratio(savedAmongRegistered, registeredInPeriod.length),
    firstSaveToFirstRetrieval: ratio(retrieved, firstSavers.length),
  };
}

/** Of the readers active in the week starting at `weekStart`, the share who made at least one retrieval in it. */
export function weeklyRetrievalRate(rows: EventRow[], weekStart: number) {
  const end = weekStart + WEEK;
  const active = activeActors(rows, weekStart, end);
  const retrievers = new Set<string>();
  for (const r of readers(rows)) if (inRange(r, weekStart, end) && isRetrieval(r)) retrievers.add(r.actor);
  const n = [...active].filter((a) => retrievers.has(a)).length;
  return { active: active.size, retrievers: n, rate: ratio(n, active.size) };
}

export function perActiveUser(rows: EventRow[], from: number, to: number) {
  const active = activeActors(rows, from, to).size;
  const count = (event: string) => readers(rows).filter((r) => r.event === event && inRange(r, from, to)).length;
  const saves = count("document_saved");
  const questions = count("ai_question_asked");
  return { activeUsers: active, savesPerActiveUser: ratio(saves, active), aiQuestionsPerActiveUser: ratio(questions, active) };
}

/**
 * Day-N retention: of the readers first seen on a day that is at least N days before `asOf`, the share who did something active exactly N days
 * later. Cohorts too young for N are left out of that N, not counted as lost.
 */
export function retention(rows: EventRow[], asOf: number, days: readonly number[] = [1, 7, 30, 90]) {
  const first = firstSeen(rows);
  const activeDays = new Map<string, Set<number>>();
  for (const r of readers(rows)) if (isActive(r)) (activeDays.get(r.actor) ?? activeDays.set(r.actor, new Set()).get(r.actor)!).add(day(r.at));
  return days.map((n) => {
    let eligible = 0;
    let retained = 0;
    for (const [actor, t] of first) {
      const target = day(t) + n;
      if ((target + 1) * DAY > asOf) continue; // the target day is not over yet
      eligible++;
      if (activeDays.get(actor)?.has(target)) retained++;
    }
    return { day: n, eligible, retained, rate: ratio(retained, eligible) };
  });
}

/** Activation: of the readers first seen at least `windowMs` before `asOf`, the share whose first active event came within `windowMs` of first being seen. */
export function activation(rows: EventRow[], asOf: number, windowMs = DAY) {
  const first = firstSeen(rows);
  const firstActive = firstOf(rows, isActive);
  let eligible = 0;
  let activated = 0;
  for (const [actor, t] of first) {
    if (t + windowMs > asOf) continue;
    eligible++;
    const a = firstActive.get(actor);
    if (a !== undefined && a - t <= windowMs) activated++;
  }
  return { eligible, activated, rate: ratio(activated, eligible) };
}

/** Visits and registrations by acquisition channel for [from, to). */
export function byChannel(rows: EventRow[], from: number, to: number) {
  const out = new Map<string, { visits: number; registrations: number }>();
  const slot = (c: string) => out.get(c) ?? out.set(c, { visits: 0, registrations: 0 }).get(c)!;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!inRange(r, from, to)) continue;
    const c = r.channel || "direct";
    if (r.event === "landing_viewed" && !seen.has(`${r.actor}:${day(r.at)}`)) {
      seen.add(`${r.actor}:${day(r.at)}`);
      slot(c).visits++;
    } else if (r.event === "account_registered") slot(c).registrations++;
  }
  return [...out].map(([channel, v]) => ({ channel, ...v, visitToRegistration: ratio(v.registrations, v.visits) })).sort((a, b) => b.visits - a.visits);
}

/* ------------------------------------------------------------------ money: needs billing, which does not exist yet */

export interface Subscription {
  plan: string;
  startedAt: number;
  cancelledAt?: number | null;
  channel?: string | null;
}

export interface PaidInput {
  from: number;
  to: number;
  /** Distinct readers active in the period who were not paying at its start. */
  activeFreeUsers: number;
  subscriptions: Subscription[];
  /** Monthly recurring revenue per plan, in US dollars, for the period (what was charged, before fees). */
  revenueUsdByPlan: Record<string, number>;
  /** What the shared AI cost for the subscribers of each plan in the period (the ledger, split by plan). */
  aiCostUsdByPlan: Record<string, number>;
  /** What was spent to acquire users, per channel, in the period (from the owner; the product cannot know it). */
  spendUsdByChannel: Record<string, number>;
  /** Payment processor fee as a share of revenue (0.029 for 2.9%); default 0. */
  paymentFeeRate?: number;
}

export function paidMetrics(i: PaidInput) {
  const paidAtStart = i.subscriptions.filter((s) => s.startedAt < i.from && (s.cancelledAt == null || s.cancelledAt >= i.from));
  const started = i.subscriptions.filter((s) => s.startedAt >= i.from && s.startedAt < i.to);
  const cancelled = i.subscriptions.filter((s) => s.cancelledAt != null && s.cancelledAt >= i.from && s.cancelledAt < i.to);
  const periodMonths = (i.to - i.from) / (30 * DAY);
  const churnedFromStart = paidAtStart.filter((s) => s.cancelledAt != null && s.cancelledAt < i.to).length;
  const monthlyChurn = paidAtStart.length && periodMonths > 0 ? 1 - Math.pow(1 - churnedFromStart / paidAtStart.length, 1 / periodMonths) : null;
  const fee = i.paymentFeeRate ?? 0;
  const revenue = Object.values(i.revenueUsdByPlan).reduce((a, b) => a + b, 0);
  const aiCost = Object.values(i.aiCostUsdByPlan).reduce((a, b) => a + b, 0);
  const payingNow = paidAtStart.length + started.length - cancelled.length;
  const arpu = ratio(revenue, paidAtStart.length + started.length);
  const margin = ratio(revenue * (1 - fee) - aiCost, revenue);
  const ltv = arpu !== null && margin !== null && monthlyChurn ? (arpu * margin) / monthlyChurn : null;
  const channels = new Set([...Object.keys(i.spendUsdByChannel), ...started.map((s) => s.channel || "direct")]);
  const cac = [...channels].map((channel) => {
    const n = started.filter((s) => (s.channel || "direct") === channel).length;
    const spend = i.spendUsdByChannel[channel] ?? 0;
    const value = ratio(spend, n);
    return { channel, newPaid: n, spendUsd: spend, cacUsd: value, ltvToCac: ltv !== null && value ? ltv / value : null };
  });
  const plans = new Set([...Object.keys(i.revenueUsdByPlan), ...Object.keys(i.aiCostUsdByPlan)]);
  const marginByPlan = [...plans].map((plan) => {
    const r = i.revenueUsdByPlan[plan] ?? 0;
    const c = i.aiCostUsdByPlan[plan] ?? 0;
    return { plan, revenueUsd: r, aiCostUsd: c, grossMargin: ratio(r * (1 - fee) - c, r) };
  });
  return {
    freeToPaid: ratio(started.length, i.activeFreeUsers),
    monthlyChurn,
    payingAtEnd: payingNow,
    arpuUsd: arpu,
    ltvUsd: ltv,
    cac,
    grossMarginByPlan: marginByPlan,
  };
}
