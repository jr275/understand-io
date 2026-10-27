import { afterEach, describe, expect, it, vi } from "vitest";
import { CHARS_PER_TOKEN, budgetLimits, costMicro, quotaFor, quotasOff, toMicro, worstCaseGloss, worstCaseOp } from "@/lib/ai/budget";
import { estimateCost } from "@/lib/ai/provider";
import type { AiOpInput, OpBlock } from "@/lib/ai/ops";

afterEach(() => vi.unstubAllEnvs());

const para = (i: number, chars: number): OpBlock => ({ id: `p${i}`, n: i, type: "p", text: "x".repeat(chars) });
const input = (over: Partial<AiOpInput> = {}): AiOpInput => ({ op: "summarize", variant: "quick", title: "T", blocks: [para(1, 1000)], totalParagraphs: 1, ...over });

describe("quotas come from the environment, with the beta's numbers as defaults", () => {
  it("defaults: 3 questions a day for a visitor, 20 for a signed-in user", () => {
    expect(quotaFor("ai")).toMatchObject({ anon: 3, user: 20 });
    expect(quotaFor("ai").anonIp).toBeGreaterThan(quotaFor("ai").anon); // a shared address is allowed more than one browser
    expect(quotaFor("ai").anonGlobal).toBeGreaterThan(quotaFor("ai").anonIp);
  });
  it("each number can be changed without a release", () => {
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_PER_DAY", "5");
    vi.stubEnv("GLOSS_QUOTA_AI_USER_PER_DAY", "50");
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_IP_PER_DAY", "12");
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_GLOBAL_PER_DAY", "99");
    expect(quotaFor("ai")).toEqual({ anon: 5, user: 50, anonIp: 12, anonGlobal: 99 });
    vi.stubEnv("GLOSS_QUOTA_SEARCH_USER_PER_DAY", "7");
    expect(quotaFor("search").user).toBe(7);
  });
  it("a zero is a real setting (no free questions); an unreadable one falls back to the default instead of opening the gate", () => {
    vi.stubEnv("GLOSS_QUOTA_AI_ANON_PER_DAY", "0");
    expect(quotaFor("ai").anon).toBe(0);
    for (const bad of ["many", "-4", "NaN", "  "]) {
      vi.stubEnv("GLOSS_QUOTA_AI_ANON_PER_DAY", bad);
      expect(quotaFor("ai").anon).toBe(3);
    }
  });
  it("the off switch works in development and tests, and is ignored in production", () => {
    vi.stubEnv("GLOSS_QUOTAS", "off");
    vi.stubEnv("NODE_ENV", "test");
    expect(quotasOff()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(quotasOff()).toBe(false);
  });
});

describe("the global budget", () => {
  it("has defaults, can be set in dollars, and 0 pauses the shared AI", () => {
    expect(budgetLimits().dailyMicro).toBeGreaterThan(0);
    expect(budgetLimits().monthlyMicro).toBeGreaterThanOrEqual(budgetLimits().dailyMicro);
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "1.5");
    vi.stubEnv("GLOSS_BUDGET_MONTHLY_USD", "20");
    expect(budgetLimits()).toEqual({ dailyMicro: 1_500_000, monthlyMicro: 20_000_000 });
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "0");
    expect(budgetLimits().dailyMicro).toBe(0);
  });
  it("ignores an unreadable setting rather than treating it as unlimited", () => {
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "lots");
    expect(budgetLimits().dailyMicro).toBe(toMicro(3));
    vi.stubEnv("GLOSS_BUDGET_DAILY_USD", "-1");
    expect(budgetLimits().dailyMicro).toBe(toMicro(3));
  });
  it("prices can be stated from the provider's billing page, and both must be set to take effect", () => {
    const table = estimateCost("some/unknown-model", 1_000_000, 1_000_000);
    vi.stubEnv("GLOSS_PRICE_IN_PER_M", "0.10");
    expect(estimateCost("some/unknown-model", 1_000_000, 1_000_000)).toBe(table); // only one of the two: ignored
    vi.stubEnv("GLOSS_PRICE_OUT_PER_M", "0.40");
    expect(estimateCost("some/unknown-model", 1_000_000, 1_000_000)).toBeCloseTo(0.5, 6);
  });
});

describe("what a request can cost at most", () => {
  it("a short text is one call, asked at most twice, at the variant's output cap plus room to think", () => {
    const one = worstCaseOp(input());
    expect(one.outputTokens).toBe((800 + 1200) * 2);
    expect(one.inputTokens).toBeGreaterThan(Math.ceil(1000 / CHARS_PER_TOKEN));
  });
  it("study notes can cost more than a quick summary", () => {
    expect(worstCaseOp(input({ variant: "study" })).outputTokens).toBeGreaterThan(worstCaseOp(input({ variant: "quick" })).outputTokens);
  });
  it("a long text is read section by section: every section's call is counted, then the combining call", () => {
    const long = Array.from({ length: 21 }, (_, k) => para(k + 1, 3000));
    const e = worstCaseOp(input({ variant: "study", blocks: long, totalParagraphs: 21 }));
    const sections = 7; // 21 paragraphs of 3000 characters, 9000 characters per section
    expect(e.outputTokens).toBe((sections * (900 + 1200) + (5000 + 1200)) * 2);
    expect(e.inputTokens).toBeGreaterThan(Math.ceil((21 * 3000) / CHARS_PER_TOKEN)); // more than one pass over the text
  });
  it("is capped by the number of sections one request may read", () => {
    const huge = Array.from({ length: 120 }, (_, k) => para(k + 1, 3000));
    const capped = worstCaseOp(input({ variant: "quick", blocks: huge, totalParagraphs: 120 }));
    expect(capped.outputTokens).toBe((8 * (900 + 1200) + (800 + 1200)) * 2); // never more than 8 sections
  });
  it("a translation is counted by its selection, a margin answer by what it sends and its cap", () => {
    const t = worstCaseOp(input({ op: "translate", selection: "y".repeat(400), blocks: [] }));
    expect(t.outputTokens).toBe((Math.min(2400, 300 + 200) + 1200) * 2);
    expect(worstCaseGloss(9000, 1420)).toEqual({ inputTokens: Math.ceil((9000 + 1800) / CHARS_PER_TOKEN), outputTokens: 1420 });
  });
  it("costs at least one millionth of a dollar, so every request shows in the ledger", () => {
    expect(costMicro({ inputTokens: 0, outputTokens: 0 })).toBe(1);
    expect(costMicro({ inputTokens: 1_000_000, outputTokens: 0 }, "deepseek-ai/DeepSeek-V3.1")).toBe(600_000);
  });
});
