import { z } from "zod";

/**
 * The event taxonomy: every event the product may record, and for each the only properties it may carry. Nothing here can hold what a
 * reader reads or writes: no text, no title, no address of a saved page, no note, no question, no search query. Properties are small
 * enumerations or buckets, and an event with a property that is not listed here is dropped whole (`parseEvent`), never stored with extras.
 * `docs/product/analytics.md` is the human version of this file; `tests/unit/analyticsEvents.test.ts` keeps the two honest.
 */

const kind = z.enum(["sample", "url", "pdf", "text", "file", "link", "epub", "docx", "html"]);
/** How old a saved text was when it was opened: a bucket, never a date. */
const ageBucket = z.enum(["0d", "1-6d", "7-29d", "30d+"]);
/** A count as a bucket, so a result count cannot identify a library. */
const countBucket = z.enum(["0", "1-3", "4-10", "11+"]);

const none = z.object({}).strict();

export const EVENT_SCHEMAS = {
  /** The landing page was shown. Carries no properties; where the visit came from travels in `attribution`. */
  landing_viewed: none,
  /** A first sign-in created an account (server side, from the sign-in callback). */
  account_registered: z.object({ method: z.enum(["google"]) }).strict(),
  /** A text was added to the library (after the server or the browser accepted it). */
  document_saved: z.object({ kind, via: z.enum(["link", "paste", "file", "page", "bookmarklet", "extension"]) }).strict(),
  /** A text was opened in the reader. `via` says where the reader came from; `age` how long the text had been saved. */
  document_opened: z.object({ kind, via: z.enum(["landing", "library", "search", "direct"]), age: ageBucket }).strict(),
  /** A mark was made. The mark's text and note are never sent: only its kind. */
  highlight_created: z.object({ mark: z.enum(["highlight", "underline", "note"]) }).strict(),
  /** A question went to the model (a margin answer or a structured operation). Never the question, the passage or the answer. */
  ai_question_asked: z.object({ action: z.string().regex(/^[a-z]{3,16}(:[a-z]{3,12})?$/), key: z.enum(["shared", "own"]) }).strict(),
  /** The library or one text was searched. Never the query. */
  library_searched: z.object({ scope: z.enum(["library", "text"]), results: countBucket }).strict(),
  /** An import finished, successfully or not. */
  import_completed: z.object({ source: z.enum(["link", "paste", "file", "page"]), outcome: z.enum(["ok", "duplicate", "link_only", "failed"]) }).strict(),
  /** The browser extension reported that it is installed (not built yet: reserved so the taxonomy does not change when it is). */
  extension_installed: z.object({ browser: z.enum(["chrome", "firefox", "safari", "edge", "other"]) }).strict(),
  /** A paid plan began (server side, from billing; not built yet). */
  subscription_started: z.object({ plan: z.string().regex(/^[a-z0-9_-]{1,32}$/), interval: z.enum(["month", "year"]) }).strict(),
  /** A paid plan ended or was cancelled (server side, from billing; not built yet). */
  subscription_cancelled: z.object({ plan: z.string().regex(/^[a-z0-9_-]{1,32}$/), tenure: z.enum(["<30d", "30-89d", "90-364d", "365d+"]) }).strict(),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

/** Events a visitor's browser may send. The others are recorded only by the server, so a browser cannot invent a registration or a payment. */
export const CLIENT_EVENTS: readonly EventName[] = ["landing_viewed", "document_saved", "document_opened", "highlight_created", "ai_question_asked", "library_searched", "import_completed", "extension_installed"];

// The definitions of "active" and "retrieval" live with the metrics (which have no imports, so a plain Node script can run them).
export { ACTIVE_EVENTS, isRetrieval } from "./metrics";

export const bucketAge = (savedAtMs: number, nowMs: number): z.infer<typeof ageBucket> => {
  const days = Math.max(0, Math.floor((nowMs - savedAtMs) / 86_400_000));
  return days < 1 ? "0d" : days < 7 ? "1-6d" : days < 30 ? "7-29d" : "30d+";
};

export const bucketCount = (n: number): z.infer<typeof countBucket> => (n <= 0 ? "0" : n <= 3 ? "1-3" : n <= 10 ? "4-10" : "11+");

/** The routes an event may name, with every identifier replaced: `/read/my-private-title` is recorded as `/read/:slug`. */
export function routePattern(path: string | undefined): string | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0].slice(0, 200);
  if (!clean.startsWith("/")) return null;
  if (clean === "/") return "/";
  if (/^\/read\/[^/]+\/?$/.test(clean)) return "/read/:slug";
  if (/^\/learn\/[^/]+\/?$/.test(clean)) return "/learn/:page";
  if (/^\/legal\/[^/]+\/?$/.test(clean)) return "/legal/:doc";
  if (["/library", "/privacy", "/terms"].includes(clean.replace(/\/$/, ""))) return clean.replace(/\/$/, "");
  return "/other";
}

export interface ParsedEvent {
  event: EventName;
  props: Record<string, unknown>;
}

/** An event the schema accepts, or null: an unknown name, a property that is not listed, a value that is not allowed. */
export function parseEvent(name: unknown, props: unknown): ParsedEvent | null {
  if (typeof name !== "string" || !(name in EVENT_SCHEMAS)) return null;
  const parsed = EVENT_SCHEMAS[name as EventName].safeParse(props ?? {});
  return parsed.success ? { event: name as EventName, props: parsed.data as Record<string, unknown> } : null;
}
