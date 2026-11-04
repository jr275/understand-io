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

/**
 * The AI actions that exist today, spelled out. A closed list, not a pattern: a pattern would let anything of the right shape through, and the
 * point of this field is that it can only ever name a button, never carry what the reader asked. `tests/unit/analyticsEvents.test.ts` checks the
 * list against the actions and summary variants the product defines, so adding one without adding it here fails a test instead of dropping events.
 */
export const AI_ACTIONS = [
  "ask", "explain", "simplify", "define", "factcheck", "related", "counterpoint", "overview", "whole",
  "summarize", "summarize:quick", "summarize:executive", "summarize:detailed", "summarize:ideas", "summarize:study", "summarize:passage",
  "concepts", "questions", "translate",
] as const;

/**
 * The paid plans, as a closed list too. Billing does not exist yet, so there is one reserved id; the real plan ids replace it in the change that
 * builds billing. It is not a free string because a plan field that accepts any token is a field a customer-chosen name can travel in.
 */
export const PLAN_IDS = ["paid"] as const;

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
  ai_question_asked: z.object({ action: z.enum(AI_ACTIONS), key: z.enum(["shared", "own"]) }).strict(),
  /** The library or one text was searched. Never the query. */
  library_searched: z.object({ scope: z.enum(["library", "text"]), results: countBucket }).strict(),
  /** An import finished, successfully or not. */
  import_completed: z.object({ source: z.enum(["link", "paste", "file", "page"]), outcome: z.enum(["ok", "duplicate", "link_only", "failed"]) }).strict(),
  /** The browser extension reported that it is installed (not built yet: reserved so the taxonomy does not change when it is). */
  extension_installed: z.object({ browser: z.enum(["chrome", "firefox", "safari", "edge", "other"]) }).strict(),
  /** A paid plan began (server side, from billing; not built yet). */
  subscription_started: z.object({ plan: z.enum(PLAN_IDS), interval: z.enum(["month", "year"]) }).strict(),
  /** A paid plan ended or was cancelled (server side, from billing; not built yet). */
  subscription_cancelled: z.object({ plan: z.enum(PLAN_IDS), tenure: z.enum(["<30d", "30-89d", "90-364d", "365d+"]) }).strict(),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

/** Events a visitor's browser may send. The others are recorded only by the server, so a browser cannot invent a registration or a payment. */
export const CLIENT_EVENTS: readonly EventName[] = ["landing_viewed", "document_saved", "document_opened", "highlight_created", "ai_question_asked", "library_searched", "import_completed", "extension_installed"];

// The definitions of "active" and "retrieval" live with the metrics (which have no imports, so a plain Node script can run them).
export { ACTIVE_EVENTS, isRetrieval } from "./metrics";

export { bucketAge, bucketCount, routePattern } from "./buckets";

export interface ParsedEvent {
  event: EventName;
  props: Record<string, unknown>;
}

/** An event the schema accepts, or null: an unknown name, a property that is not listed, a value that is not allowed. */
export function parseEvent(name: unknown, props: unknown): ParsedEvent | null {
  // Own properties only: `"constructor" in EVENT_SCHEMAS` is true, and a name that is not an event must be refused, not looked up.
  if (typeof name !== "string" || !Object.hasOwn(EVENT_SCHEMAS, name)) return null;
  const parsed = EVENT_SCHEMAS[name as EventName].safeParse(props ?? {});
  return parsed.success ? { event: name as EventName, props: parsed.data as Record<string, unknown> } : null;
}
