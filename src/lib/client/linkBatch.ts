import type { GlossDocument } from "@/lib/content/types";
import { normalizeSourceUrl } from "@/lib/store/duplicates";
import { normaliseUrl, urlProblem } from "./import";

/** How many links one go reads. The server allows 60 imports in 10 minutes per reader, so one batch never uses it all up. */
export const MAX_LINKS = 50;

export interface ParsedLinks {
  /** The addresses to read: trimmed, given a scheme, without repeats, in the order they were written. */
  urls: string[];
  /** Lines that are not web addresses, with their 1-based line number: reported, never sent. */
  invalid: { line: number; text: string; why: "scheme" | "invalid" }[];
  /** How many lines repeated an address already in the batch (the same page by address, ignoring `www.`, a trailing slash and tracking parameters). */
  repeated: number;
  /** How many valid addresses were left out because the batch is full. */
  over: number;
}

/**
 * One link per line. Only line breaks separate links: a comma, a space or a semicolon never does, so an address that contains one stays whole
 * (and a line that holds two addresses is reported, not guessed at). Empty lines and surrounding spaces are ignored.
 */
export function parseLinks(text: string): ParsedLinks {
  const out: ParsedLinks = { urls: [], invalid: [], repeated: 0, over: 0 };
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.replace(/^[\s​﻿]+|[\s​﻿]+$/g, "");
    if (!line) return;
    const problem = urlProblem(line);
    if (problem) {
      out.invalid.push({ line: i + 1, text: line.length > 120 ? `${line.slice(0, 117)}…` : line, why: problem });
      return;
    }
    const url = normaliseUrl(line);
    const key = normalizeSourceUrl(url) ?? url;
    if (seen.has(key)) {
      out.repeated++;
      return;
    }
    seen.add(key);
    if (out.urls.length >= MAX_LINKS) out.over++;
    else out.urls.push(url);
  });
  return out;
}

/** `waiting` and `working` are in flight; the rest are final until a retry. `link` is saved as a card only (its page could not be read). */
export type RowState = "waiting" | "working" | "saved" | "link" | "duplicate" | "failed" | "skipped";

export interface Row {
  id: number;
  url: string;
  state: RowState;
  title?: string;
  slug?: string;
  /** Why it failed or was skipped (the server's words; the screen localizes them). */
  error?: string;
  /** For `link`: why the page could not be read. */
  reason?: string;
}

export interface LinkResult {
  document: GlossDocument;
  persisted: boolean;
  duplicate?: boolean;
  linkOnly?: boolean;
  reason?: string;
}

export interface Summary {
  total: number;
  saved: number;
  linkOnly: number;
  duplicate: number;
  failed: number;
  skipped: number;
  /** In flight (waiting or working). */
  pending: number;
  /** The address being read right now. */
  current: string | null;
  done: boolean;
}

export interface Deps {
  /** One request to the import endpoint. Rejects with an `Error` (and an optional numeric `status`) when the link could not be saved. */
  send: (url: string) => Promise<LinkResult>;
  /** The saved text the library already holds for this address, if it is one a repeat would only copy. */
  known: (url: string) => GlossDocument | null;
  /** Settles the reader's cookie before the first request, so a new visitor's batch cannot create two readers. */
  ready: () => Promise<unknown>;
  /** Called with each server answer as soon as it is in, before the row changes: the document is kept even if the page is closed right after. */
  onResult?: (r: LinkResult) => void;
  onDone?: (s: Summary) => void;
}

/**
 * A list of links read one after another. Each link has its own outcome: one that fails never touches the others, and a row is only ever `saved`
 * after the server has said so. Sequential on purpose: the reader's cookie, the library sync and the server's import limit all behave best with one
 * request at a time, and a batch is a convenience, not a way to load the server. A 429 stops the rest of the batch (they are marked failed, with the
 * server's wording) instead of hammering a limit that has been reached.
 */
export class LinkBatch {
  rows: Row[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private active = false;

  constructor(private deps: Deps) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  /** The rows as one value that changes identity on every update (for `useSyncExternalStore`). */
  getSnapshot = () => this.rows;
  private set(rows: Row[]) {
    this.rows = rows;
    this.listeners.forEach((l) => l());
  }
  private patch(id: number, p: Partial<Row>) {
    this.set(this.rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  get running() {
    return this.active;
  }

  summary(): Summary {
    const c = (s: RowState) => this.rows.filter((r) => r.state === s).length;
    const pending = c("waiting") + c("working");
    return {
      total: this.rows.length,
      saved: c("saved") + c("link"),
      linkOnly: c("link"),
      duplicate: c("duplicate"),
      failed: c("failed"),
      skipped: c("skipped"),
      pending,
      current: this.rows.find((r) => r.state === "working")?.url ?? null,
      done: this.rows.length > 0 && pending === 0,
    };
  }

  /** Starts a new batch. Refused (false) while one is running or when there is nothing to read: a second press of the button cannot send anything twice. */
  start(parsed: ParsedLinks): boolean {
    if (this.active || (!parsed.urls.length && !parsed.invalid.length)) return false;
    const rows: Row[] = [
      ...parsed.urls.map((url): Row => ({ id: this.nextId++, url, state: "waiting" })),
      ...parsed.invalid.map((i): Row => ({ id: this.nextId++, url: i.text, state: "skipped", error: i.why === "scheme" ? "scheme" : "invalid" })),
    ];
    this.set(rows);
    if (!parsed.urls.length) return true;
    void this.run();
    return true;
  }

  /** Reads the failed links again; the saved ones are not sent a second time. */
  retryFailed(): boolean {
    if (this.active || !this.rows.some((r) => r.state === "failed")) return false;
    this.set(this.rows.map((r) => (r.state === "failed" ? { ...r, state: "waiting", error: undefined } : r)));
    void this.run();
    return true;
  }

  clear() {
    if (!this.active) this.set([]);
  }

  private async run() {
    this.active = true;
    try {
      await this.deps.ready().catch(() => undefined); // a failed bootstrap shows up as each request's own error
      for (const row of this.rows.filter((r) => r.state === "waiting")) {
        const known = this.deps.known(row.url);
        if (known) {
          this.patch(row.id, { state: "duplicate", title: known.title, slug: known.slug });
          continue;
        }
        this.patch(row.id, { state: "working" });
        try {
          const r = await this.deps.send(row.url);
          this.deps.onResult?.(r);
          this.patch(row.id, { state: r.duplicate ? "duplicate" : r.linkOnly ? "link" : "saved", title: r.document.title, slug: r.document.slug, reason: r.linkOnly ? r.reason : undefined });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Import failed.";
          this.patch(row.id, { state: "failed", error: message });
          if ((e as { status?: number } | null)?.status === 429) {
            // The limit was reached: the links not yet tried are failed with the same words, so Retry picks them up later.
            this.set(this.rows.map((r) => (r.state === "waiting" ? { ...r, state: "failed", error: message } : r)));
            break;
          }
        }
      }
    } finally {
      this.active = false;
      this.listeners.forEach((l) => l());
      this.deps.onDone?.(this.summary());
    }
  }
}
