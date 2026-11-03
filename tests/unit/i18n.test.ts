// The internationalization core: how a visitor's language is found, how a message is built, how numbers and dates read, how the proxy routes
// languages, and what the assistant is told. The completeness of the dictionaries is in i18nCoverage.test.ts.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, PUBLIC_HEADER, localeFromAcceptLanguage, localePath, normalizeLocale, splitLocalePath } from "@/i18n/config";
import { formatCurrency, formatDate, formatList, formatNumber, formatPercent, formatRelative } from "@/i18n/format";
import { requestLocale, resolveLocale } from "@/i18n/server";
import { translate, translatorFor } from "@/i18n/translate";
import { isPublicPath, proxy } from "@/proxy";
import { languageRule, systemPrompt } from "@/lib/ai/prompts";
import { runAiOp, type Generate } from "@/lib/ai/ops";

describe("finding a visitor's language", () => {
  it("English is the default, and every spelling of Portuguese is Brazilian Portuguese", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    for (const s of ["pt", "pt-BR", "pt_br", "PT-br", "pt-PT"]) expect(normalizeLocale(s), s).toBe("pt-BR");
    for (const s of ["en", "en-US", "en-GB", "EN"]) expect(normalizeLocale(s), s).toBe("en");
    for (const s of ["", "fr", "es-ES", "xx", null, undefined]) expect(normalizeLocale(s as string | null), String(s)).toBeNull();
  });

  it("reads Accept-Language by quality, not by position, and ignores what it does not support", () => {
    expect(localeFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,pt;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("fr;q=0.9,pt;q=0.8,en;q=0.7")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("en;q=0.5,pt;q=0.9")).toBe("pt-BR");
    expect(localeFromAcceptLanguage("pt;q=0,en")).toBe("en"); // q=0 means "not acceptable"
    expect(localeFromAcceptLanguage("fr,de;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
  });

  it("an address with a language prefix wins; an indexed page ignores the cookie and the browser; the app's own pages use the choice, then the browser", () => {
    expect(resolveLocale({ header: "pt-BR", isPublic: true, cookie: "en", acceptLanguage: "en" })).toBe("pt-BR");
    expect(resolveLocale({ isPublic: true, cookie: "pt-BR", acceptLanguage: "pt-BR" })).toBe("en");
    expect(resolveLocale({ isPublic: false, cookie: "pt-BR", acceptLanguage: "en" })).toBe("pt-BR");
    expect(resolveLocale({ isPublic: false, cookie: "en", acceptLanguage: "pt-BR" })).toBe("en"); // an explicit choice beats the browser
    expect(resolveLocale({ isPublic: false, cookie: null, acceptLanguage: "pt-BR,en;q=0.5" })).toBe("pt-BR");
    expect(resolveLocale({ isPublic: false, cookie: "klingon", acceptLanguage: "fr" })).toBe("en");
    expect(resolveLocale({})).toBe("en");
  });

  it("an API request is judged by its cookie, then its Accept-Language", () => {
    const r = (h: Record<string, string>) => new Request("http://x.test/api/ai", { headers: h });
    expect(requestLocale(r({ cookie: "a=1; gloss_lang=pt-BR; b=2" }))).toBe("pt-BR");
    expect(requestLocale(r({ cookie: "gloss_lang=en", "accept-language": "pt-BR" }))).toBe("en");
    expect(requestLocale(r({ "accept-language": "pt-BR,pt;q=0.9" }))).toBe("pt-BR");
    expect(requestLocale(r({}))).toBe("en");
  });
});

describe("addresses", () => {
  it("keep every existing English address as it is, and put Portuguese under /pt-BR", () => {
    for (const p of ["/", "/library", "/read/walden-reading", "/privacy", "/learn/x"]) expect(localePath(p, "en")).toBe(p);
    expect(localePath("/", "pt-BR")).toBe("/pt-BR");
    expect(localePath("/privacy", "pt-BR")).toBe("/pt-BR/privacy");
    expect(splitLocalePath("/pt-BR")).toEqual({ locale: "pt-BR", path: "/" });
    expect(splitLocalePath("/pt-BR/privacy")).toEqual({ locale: "pt-BR", path: "/privacy" });
    expect(splitLocalePath("/privacy")).toEqual({ locale: "en", path: "/privacy" });
    expect(splitLocalePath("/pt-BRx/privacy")).toEqual({ locale: "en", path: "/pt-BRx/privacy" }); // a prefix is a whole segment
    for (const p of ["/", "/library", "/a/b/c"]) expect(splitLocalePath(localePath(p, "pt-BR")).path).toBe(p);
  });
});

describe("messages", () => {
  it("fill placeholders, leave an unknown placeholder visible, and fall back to English for a key the language lacks", () => {
    expect(translate("en", "topbar.shelved", { n: 3 })).toBe("3 articles shelved.");
    expect(translate("pt-BR", "account.signedInAs", { name: "Ana" })).toBe("Conectado como Ana");
    expect(translate("en", "account.signedInAs")).toBe("Signed in as {name}");
    expect(translate("en", "nope.nothing" as never)).toBe("nope.nothing"); // a missing key shows itself, never a blank
  });

  it("choose the plural by the language's own rules (one article, 0 and 1 are singular in Portuguese, 0 is plural in English)", () => {
    const en = translatorFor("en");
    const pt = translatorFor("pt-BR");
    expect(en("topbar.shelved", { n: 1 })).toBe("1 article shelved.");
    expect(en("topbar.shelved", { n: 0 })).toBe("0 articles shelved.");
    expect(pt("topbar.shelved", { n: 1 })).toBe("1 artigo guardado.");
    expect(pt("topbar.shelved", { n: 2 })).toBe("2 artigos guardados.");
    expect(pt("topbar.shelved", { n: 0 })).toBe("0 artigo guardado.");
  });
});

describe("numbers, money and dates", () => {
  it("follow the locale's separators, symbols and order", () => {
    expect(formatNumber("en", 1234567.89)).toBe("1,234,567.89");
    expect(formatNumber("pt-BR", 1234567.89)).toBe("1.234.567,89");
    expect(formatCurrency("en", 1234.5, "USD")).toBe("$1,234.50");
    expect(formatCurrency("pt-BR", 1234.5, "BRL").replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatPercent("pt-BR", 0.875, 1)).toBe("87,5%");
    const d = Date.UTC(2026, 10, 3, 12);
    expect(formatDate("en", d, { dateStyle: "long", timeZone: "UTC" })).toBe("November 3, 2026");
    expect(formatDate("pt-BR", d, { dateStyle: "long", timeZone: "UTC" })).toBe("3 de novembro de 2026");
    expect(formatList("en", ["a", "b", "c"])).toBe("a, b, and c");
    expect(formatList("pt-BR", ["a", "b", "c"])).toBe("a, b e c");
  });

  it("say 'ago' in the reader's language", () => {
    const now = Date.UTC(2026, 10, 3, 12);
    expect(formatRelative("en", now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(formatRelative("pt-BR", now - 3 * 86_400_000, now)).toBe("há 3 dias");
    expect(formatRelative("pt-BR", now + 2 * 3_600_000, now)).toBe("em 2 horas");
  });
});

describe("the proxy and the language of a page", () => {
  const page = (path: string, o: { cookie?: string; method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost${path}`, { method: o.method ?? "GET", headers: { ...(o.cookie ? { cookie: `${LOCALE_COOKIE}=${o.cookie}` } : {}), ...o.headers } });
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("says which pages are indexed", () => {
    for (const p of ["/", "/privacy", "/terms", "/learn/x", "/legal/ai-notice"]) expect(isPublicPath(p), p).toBe(true);
    for (const p of ["/library", "/read/x", "/api/health"]) expect(isPublicPath(p), p).toBe(false);
  });

  it("rewrites /pt-BR/... to the same page with the language in a header (one deployment, not one per language)", () => {
    const res = proxy(page("/pt-BR/privacy?x=1"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost/privacy?x=1");
    expect(forwarded(res, LOCALE_HEADER)).toBe("pt-BR");
    expect(forwarded(res, PUBLIC_HEADER)).toBe("1");
    const home = proxy(page("/pt-BR"));
    expect(home.headers.get("x-middleware-rewrite")).toBe("http://localhost/");
  });

  it("leaves every existing English address alone, marking only whether it is an indexed page", () => {
    const res = proxy(page("/library"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).toBe(200);
    expect(forwarded(res, LOCALE_HEADER)).toBeNull();
    expect(forwarded(res, PUBLIC_HEADER)).toBe("0");
    expect(forwarded(proxy(page("/")), PUBLIC_HEADER)).toBe("1");
  });

  it("never trusts a language header that came from outside", () => {
    const res = proxy(page("/library", { headers: { [LOCALE_HEADER]: "pt-BR", [PUBLIC_HEADER]: "0" } }));
    expect(forwarded(res, LOCALE_HEADER)).toBeNull();
    expect(forwarded(proxy(page("/", { headers: { [PUBLIC_HEADER]: "0" } })), PUBLIC_HEADER)).toBe("1");
  });

  it("opening an address in Portuguese remembers it for the pages whose address has no language; an English address and a form post set nothing", () => {
    const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";
    expect(setCookie(proxy(page("/pt-BR")))).toMatch(/gloss_lang=pt-BR/);
    expect(setCookie(proxy(page("/pt-BR/privacy")))).toMatch(/SameSite=lax/i);
    expect(setCookie(proxy(page("/pt-BR", { cookie: "en" })))).toMatch(/gloss_lang=pt-BR/); // an explicit address beats the earlier choice
    expect(setCookie(proxy(page("/pt-BR", { cookie: "pt-BR" })))).toBe(""); // already remembered
    expect(setCookie(proxy(page("/")))).toBe("");
    expect(setCookie(proxy(page("/library")))).toBe("");
    expect(setCookie(proxy(page("/pt-BR", { method: "POST" })))).toBe("");
  });

  it("sends a reader who chose Portuguese from an indexed English address to its Portuguese one, and only that", () => {
    const res = proxy(page("/privacy?a=b", { cookie: "pt-BR" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/pt-BR/privacy?a=b");
    expect(proxy(page("/", { cookie: "pt-BR" })).headers.get("location")).toBe("http://localhost/pt-BR");
    expect(proxy(page("/library", { cookie: "pt-BR" })).status).toBe(200); // the app's own pages follow the cookie without moving
    expect(proxy(page("/privacy", { cookie: "en" })).status).toBe(200);
    expect(proxy(page("/privacy")).status).toBe(200); // a crawler has no cookie: it always sees the English page where it was
    expect(proxy(page("/pt-BR/privacy", { cookie: "pt-BR" })).status).toBe(200);
    expect(proxy(page("/privacy", { cookie: "pt-BR", method: "POST" })).status).toBe(200); // a form post is never redirected
  });

  it("does not change what it did for the API", () => {
    expect(proxy(page("/api/health")).status).toBe(200);
    const cross = new NextRequest("http://localhost/api/documents", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
    expect(proxy(cross).status).toBe(403);
  });
});

describe("what the assistant is told about language", () => {
  it("answers in the interface language by default, whatever the text or the question, and obeys an explicit request for another", () => {
    const pt = systemPrompt("normal", "pt-BR");
    expect(pt).toMatch(/Brazilian Portuguese, the language the reader's interface is set to/);
    expect(pt).toMatch(/even when the text or the question is in another language/);
    expect(pt).toMatch(/asks? for a different language[\s\S]*use that one instead/);
    expect(systemPrompt("normal", "en")).toMatch(/Write plainly in English/);
    expect(languageRule("pt-BR")).toMatch(/responda em inglês/);
  });

  it("keeps the old rule (the question's language, else the text's) when no interface language is known", () => {
    expect(systemPrompt("normal")).toMatch(/match the language of the question if there is one, otherwise the text/);
    expect(systemPrompt("normal", "fr")).toMatch(/match the language of the question/);
  });

  const input = { op: "summarize" as const, variant: "quick" as const, blocks: [{ id: "p1", type: "p" as const, text: "A sentence about chalk and time, long enough to read." }], totalParagraphs: 1 };
  const reply = '{"items":[{"text":"x","basis":"text","evidence":[{"id":"p1","quote":"A sentence about chalk"}]}],"caveats":[]}';
  const run = async (extra: Record<string, unknown>) => {
    const seen: string[] = [];
    const generate: Generate = async ({ system }) => (seen.push(system), { text: reply, inputTokens: 1, outputTokens: 1 });
    await runAiOp({ ...input, ...extra } as never, generate).catch(() => {});
    return seen.join("\n");
  };

  it("summaries, concepts and questions are written in the interface language unless an output language was chosen", async () => {
    expect(await run({ uiLang: "pt-BR" })).toMatch(/in Brazilian Portuguese, the language the reader's interface is set to/);
    expect(await run({ uiLang: "pt-BR", outputLang: "es" })).toMatch(/in Spanish\./);
    expect(await run({ uiLang: "pt-BR", outputLang: "es" })).not.toMatch(/Brazilian Portuguese/);
    expect(await run({})).toMatch(/Write in the language of the text/);
  });
});

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
