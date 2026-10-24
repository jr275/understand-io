import type { GlossDocument } from "@/lib/content/types";

/**
 * The state of one file in a batch. `sending` covers everything the server does with the file (receive, read, save): the browser cannot tell
 * those stages apart, so it does not pretend to; a file is `done` only once the server has answered that it is saved.
 */
export type QueueState = "waiting" | "sending" | "done" | "duplicate" | "failed" | "cancelled";

export interface QueueItem {
  id: number;
  name: string;
  size: number;
  state: QueueState;
  /** Why it failed, in words for the reader. */
  error?: string;
  /** Where to open it once it is done (or was already saved). */
  slug?: string;
  title?: string;
}

export interface SendResult {
  document: GlossDocument;
  persisted: boolean;
  /** The text was already in the library: `document` is the saved one, nothing new was created. */
  duplicate?: boolean;
}

export type Send = (file: File, signal: AbortSignal) => Promise<SendResult>;

/** How many files one batch may hold, and how many are sent at once: a batch is a convenience, not a way to load the server. */
export const QUEUE_LIMITS = { files: 20, concurrent: 2 } as const;

export interface BatchSummary {
  total: number;
  done: number;
  duplicate: number;
  failed: number;
  cancelled: number;
}

/**
 * A queue of files imported a few at a time. Each file has its own outcome: one failing, being cancelled or being a duplicate never touches
 * another's result. Retrying a file sends it again, which is safe because the server answers a repeat of a saved text with the saved document.
 */
export class ImportQueue {
  items: QueueItem[] = [];
  private files = new Map<number, File>();
  private controllers = new Map<number, AbortController>();
  private listeners = new Set<() => void>();
  private nextId = 1;
  private running = 0;
  private active = false;

  constructor(
    private send: Send,
    private hooks: { onResult?: (item: QueueItem, r: SendResult) => void; onBatchDone?: (s: BatchSummary) => void } = {},
    private concurrent: number = QUEUE_LIMITS.concurrent,
    /** Answers whether a file's kind can be read at all, so an unreadable one is refused at once instead of travelling to the server. */
    private accepts: (file: File) => string | null = () => null,
  ) {}

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  private emit() {
    this.items = [...this.items]; // a new array each time, so a store snapshot changes
    this.listeners.forEach((l) => l());
  }
  private patch(id: number, p: Partial<QueueItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...p } : i));
  }

  /** Adds files; returns how many were left out because the batch is full. */
  add(list: File[]): { added: number; skipped: number } {
    const room = Math.max(0, QUEUE_LIMITS.files - this.items.filter((i) => i.state === "waiting" || i.state === "sending").length);
    const take = list.slice(0, room);
    for (const file of take) {
      const id = this.nextId++;
      const refusal = this.accepts(file);
      this.items.push({ id, name: file.name, size: file.size, state: refusal ? "failed" : "waiting", error: refusal ?? undefined });
      if (!refusal) this.files.set(id, file);
    }
    if (take.length) this.active = true;
    this.emit();
    this.pump();
    return { added: take.length, skipped: list.length - take.length };
  }

  retry(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item || (item.state !== "failed" && item.state !== "cancelled") || !this.files.has(id)) return;
    this.patch(id, { state: "waiting", error: undefined });
    this.active = true;
    this.emit();
    this.pump();
  }

  /** Cancels one file: stops it if it is being sent, otherwise just takes it out of the line. */
  cancel(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.state === "sending") this.controllers.get(id)?.abort();
    else if (item.state === "waiting") {
      this.patch(id, { state: "cancelled" });
      this.emit();
      this.maybeFinish();
    }
  }

  cancelAll() {
    for (const i of this.items) if (i.state === "waiting" || i.state === "sending") this.cancel(i.id);
  }

  /** Forgets files that are over (done, duplicate, failed, cancelled); keeps those still waiting or being sent. */
  clearFinished() {
    const keep = this.items.filter((i) => i.state === "waiting" || i.state === "sending");
    for (const i of this.items) if (!keep.includes(i)) this.files.delete(i.id);
    this.items = keep;
    this.emit();
  }

  private pump() {
    while (this.running < this.concurrent) {
      const next = this.items.find((i) => i.state === "waiting");
      if (!next) break;
      void this.run(next.id);
    }
    this.maybeFinish();
  }

  private async run(id: number) {
    const file = this.files.get(id);
    if (!file) return;
    this.running += 1;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { state: "sending" });
    this.emit();
    try {
      const r = await this.send(file, controller.signal);
      this.patch(id, { state: r.duplicate ? "duplicate" : "done", slug: r.document.slug, title: r.document.title, error: undefined });
      this.hooks.onResult?.(this.items.find((i) => i.id === id)!, r);
    } catch (err) {
      if (controller.signal.aborted) this.patch(id, { state: "cancelled" });
      else this.patch(id, { state: "failed", error: err instanceof Error && err.message ? err.message : "That file could not be imported." });
    } finally {
      this.controllers.delete(id);
      this.running -= 1;
      this.emit();
      this.pump();
    }
  }

  private maybeFinish() {
    if (!this.active || this.running > 0 || this.items.some((i) => i.state === "waiting")) return;
    this.active = false;
    const count = (s: QueueState) => this.items.filter((i) => i.state === s).length;
    this.hooks.onBatchDone?.({ total: this.items.length, done: count("done"), duplicate: count("duplicate"), failed: count("failed"), cancelled: count("cancelled") });
  }
}

/** One sentence for a finished batch: what was kept, what was already there, what failed. */
export function summaryLine(s: BatchSummary): string {
  const parts = [`${s.done} of ${s.total} imported`];
  if (s.duplicate) parts.push(`${s.duplicate} already in your library`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.cancelled) parts.push(`${s.cancelled} cancelled`);
  return parts.join(", ") + ".";
}
