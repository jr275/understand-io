import { describe, expect, it } from "vitest";
import { DAY, activation, activeActors, byChannel, funnel, paidMetrics, perActiveUser, ratio, retention, wauMau, weeklyRetrievalRate, type EventRow } from "@/lib/analytics/metrics";

const T0 = Date.UTC(2026, 9, 1); // a Thursday, 00:00 UTC
const at = (days: number, hours = 12) => T0 + days * DAY + hours * 3_600_000;
const ev = (actor: string, event: string, t: number, props: Record<string, unknown> = {}, channel?: string): EventRow => ({ actor, actorKind: "reader", event, at: t, props, channel });
const visit = (actor: string, t: number, channel?: string): EventRow => ({ actor, actorKind: "daily", event: "landing_viewed", at: t, props: {}, channel });
const open = (a: string, t: number, age = "0d", via = "library") => ev(a, "document_opened", t, { kind: "url", via, age });

describe("ratio", () => {
  it("is unknown, not zero, when there is nothing to divide by", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe("funnel", () => {
  const rows: EventRow[] = [
    // ten visitor-days, three of them the same visitor on one day
    ...Array.from({ length: 8 }, (_, i) => visit(`d${i}`, at(0))),
    visit("dX", at(0, 9)),
    visit("dX", at(0, 15)),
    visit("dX", at(0, 20)),
    // four register; three save a text; two of those come back for something kept
    ev("a", "account_registered", at(0)),
    ev("b", "account_registered", at(0)),
    ev("c", "account_registered", at(1)),
    ev("d", "account_registered", at(1)),
    ev("a", "document_saved", at(0, 13), { kind: "url", via: "link" }),
    ev("b", "document_saved", at(1), { kind: "pdf", via: "file" }),
    ev("c", "document_saved", at(2), { kind: "text", via: "paste" }),
    open("a", at(3), "1-6d"),
    ev("b", "library_searched", at(4), { scope: "library", results: "1-3" }),
    open("c", at(3), "0d"), // the same day it was saved: not a retrieval
  ];

  it("counts visitor-days once, and each later step as a cohort", () => {
    const f = funnel(rows, T0, T0 + 7 * DAY);
    expect(f.visits).toBe(9);
    expect(f.registrations).toBe(4);
    expect(f.firstSaves).toBe(3);
    expect(f.firstRetrievals).toBe(2);
    expect(f.visitToRegistration).toBeCloseTo(4 / 9);
    expect(f.registrationToFirstSave).toBeCloseTo(3 / 4);
    expect(f.firstSaveToFirstRetrieval).toBeCloseTo(2 / 3);
  });

  it("says unknown when the period has no visits", () => {
    const f = funnel([], T0, T0 + DAY);
    expect(f.visitToRegistration).toBeNull();
    expect(f.registrationToFirstSave).toBeNull();
    expect(f.firstSaveToFirstRetrieval).toBeNull();
  });

  it("does not count a daily hash as a reader", () => {
    expect(activeActors([{ ...open("x", at(1)), actorKind: "daily" }], T0, T0 + 7 * DAY).size).toBe(0);
  });
});

describe("active users", () => {
  const rows: EventRow[] = [open("a", at(10)), open("b", at(10)), open("c", at(2)), ev("d", "landing_viewed", at(10))];
  it("WAU and MAU count readers with an active event, not visitors", () => {
    const r = wauMau(rows, at(11));
    expect(r.wau).toBe(2);
    expect(r.mau).toBe(3);
    expect(r.stickiness).toBeCloseTo(2 / 3);
    expect(wauMau([], at(11)).stickiness).toBeNull();
  });
  it("saves and questions per active user", () => {
    const m = perActiveUser(
      [ev("a", "document_saved", at(1)), ev("a", "document_saved", at(1, 15)), ev("b", "ai_question_asked", at(2), { action: "explain", key: "shared" }), ev("b", "document_saved", at(2)), ev("c", "library_searched", at(3))],
      T0,
      T0 + 7 * DAY,
    );
    expect(m.activeUsers).toBe(3);
    expect(m.savesPerActiveUser).toBeCloseTo(1);
    expect(m.aiQuestionsPerActiveUser).toBeCloseTo(1 / 3);
  });
});

describe("weekly knowledge retrieval rate", () => {
  it("is the share of the week's active readers who came back for something kept", () => {
    const rows = [open("a", at(1), "7-29d"), open("b", at(1), "0d"), ev("c", "highlight_created", at(2), { mark: "highlight" }), ev("d", "library_searched", at(3), { scope: "library", results: "0" })];
    expect(weeklyRetrievalRate(rows, T0)).toEqual({ active: 4, retrievers: 1, rate: 0.25 });
    expect(weeklyRetrievalRate(rows, T0 + 14 * DAY).rate).toBeNull();
  });
});

describe("retention and activation", () => {
  // a is seen on day 0, active again on day 1 and day 7; b only on day 0; c appears on day 5 (too young for D7 and beyond)
  const rows = [open("a", at(0)), open("a", at(1)), open("a", at(7)), open("b", at(0)), open("c", at(5))];
  it("counts a day as retained only when the reader was active exactly N days later, and leaves out cohorts too young", () => {
    const r = retention(rows, at(9));
    const d = (n: number) => r.find((x) => x.day === n)!;
    expect(d(1)).toMatchObject({ eligible: 3, retained: 1 });
    expect(d(7)).toMatchObject({ eligible: 2, retained: 1 });
    expect(d(30)).toMatchObject({ eligible: 0, retained: 0, rate: null });
    expect(d(90).rate).toBeNull();
  });
  it("activation: first active event within a day of first being seen", () => {
    const a = activation(
      [ev("a", "landing_viewed", at(0, 1)), ev("a", "document_saved", at(0, 5)), ev("b", "landing_viewed", at(0, 1)), ev("b", "document_saved", at(3)), ev("c", "landing_viewed", at(0, 1)), ev("e", "landing_viewed", at(9, 20))], // e was first seen less than a day before the cutoff: too young to judge
      at(10),
    );
    expect(a).toEqual({ eligible: 3, activated: 1, rate: 1 / 3 });
  });
});

describe("channels", () => {
  it("counts visitor-days and registrations per channel", () => {
    const rows = [visit("d1", at(0), "organic-search"), visit("d2", at(0), "organic-search"), visit("d3", at(0), "direct"), ev("a", "account_registered", at(0), {}, "organic-search")];
    const c = byChannel(rows, T0, T0 + DAY);
    expect(c[0]).toMatchObject({ channel: "organic-search", visits: 2, registrations: 1, visitToRegistration: 0.5 });
    expect(c[1]).toMatchObject({ channel: "direct", visits: 1, registrations: 0 });
  });
});

describe("paid metrics (inputs come from billing, which is not built)", () => {
  const from = T0;
  const to = T0 + 30 * DAY;
  const subs = [
    { plan: "pro", startedAt: from - 40 * DAY, cancelledAt: null }, // paying at the start, stays
    { plan: "pro", startedAt: from - 20 * DAY, cancelledAt: from + 10 * DAY }, // paying at the start, cancels
    { plan: "pro", startedAt: from + 3 * DAY, channel: "newsletter/email" },
    { plan: "pro", startedAt: from + 5 * DAY, channel: "organic-search" },
  ];
  const m = paidMetrics({ from, to, activeFreeUsers: 80, subscriptions: subs, revenueUsdByPlan: { pro: 40 }, aiCostUsdByPlan: { pro: 4 }, spendUsdByChannel: { "newsletter/email": 50 }, paymentFeeRate: 0 });

  it("free-to-paid, churn, paying at the end", () => {
    expect(m.freeToPaid).toBeCloseTo(2 / 80);
    expect(m.monthlyChurn).toBeCloseTo(0.5, 2); // one of the two paying at the start left within one month
    expect(m.payingAtEnd).toBe(3);
  });
  it("gross margin by plan and LTV from ARPU, margin and churn", () => {
    expect(m.grossMarginByPlan).toEqual([{ plan: "pro", revenueUsd: 40, aiCostUsd: 4, grossMargin: 0.9 }]);
    expect(m.arpuUsd).toBeCloseTo(40 / 4);
    expect(m.ltvUsd).toBeCloseTo((10 * 0.9) / 0.5, 1);
  });
  it("CAC and LTV/CAC per channel; a channel with no spend is unknown, not free", () => {
    const news = m.cac.find((c) => c.channel === "newsletter/email")!;
    expect(news).toMatchObject({ newPaid: 1, spendUsd: 50, cacUsd: 50 });
    expect(news.ltvToCac).toBeCloseTo(m.ltvUsd! / 50);
    const organic = m.cac.find((c) => c.channel === "organic-search")!;
    expect(organic.newPaid).toBe(1);
    expect(organic.spendUsd).toBe(0);
    expect(organic.cacUsd).toBe(0);
  });
  it("is unknown without data", () => {
    const empty = paidMetrics({ from, to, activeFreeUsers: 0, subscriptions: [], revenueUsdByPlan: {}, aiCostUsdByPlan: {}, spendUsdByChannel: {} });
    expect(empty).toMatchObject({ freeToPaid: null, monthlyChurn: null, ltvUsd: null, arpuUsd: null });
    expect(empty.cac).toEqual([]);
  });
  it("takes the payment processor's share off the margin", () => {
    const withFee = paidMetrics({ from, to, activeFreeUsers: 10, subscriptions: subs, revenueUsdByPlan: { pro: 100 }, aiCostUsdByPlan: { pro: 10 }, spendUsdByChannel: {}, paymentFeeRate: 0.05 });
    expect(withFee.grossMarginByPlan[0].grossMargin).toBeCloseTo((100 * 0.95 - 10) / 100);
  });
});
