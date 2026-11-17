"use client";

import Link from "next/link";
import { forwardRef, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { ArrowRight, Check, Link2, RotateCcw, X } from "lucide-react";
import { sendLink } from "@/lib/client/import";
import { LinkBatch, MAX_LINKS, parseLinks, type Row } from "@/lib/client/linkBatch";
import { ensureReader, getLibrary, rememberDocument, syncRemoteLibrary } from "@/lib/store/library";
import { findDuplicate } from "@/lib/store/duplicates";
import { useT } from "@/i18n/client";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";
import { UrlStatus, type UrlSource } from "./UrlField";

/**
 * The batch of links on screen: one `LinkBatch` (see `lib/client/linkBatch.ts`) wired to the same request, the same reader session and the same library
 * the single-link field uses. Each answer is kept in the library the moment the server confirms it, so closing the tab mid-batch loses nothing that was
 * confirmed; while it runs, leaving the page asks first.
 */
export function useLinkBatch() {
  const [batch] = useState(
    () =>
      new LinkBatch({
        send: sendLink,
        known: (url) => findDuplicate(Object.values(getLibrary().docs), { url }),
        ready: ensureReader,
        onResult: (r) => rememberDocument(r.document, r.persisted),
        onDone: () => void syncRemoteLibrary(),
      }),
  );
  const rows = useSyncExternalStore(batch.subscribe, batch.getSnapshot, batch.getSnapshot);
  const summary = useMemo(() => batch.summary(), [batch, rows]); // eslint-disable-line react-hooks/exhaustive-deps -- `rows` changes whenever the summary does
  const running = summary.pending > 0;
  useEffect(() => {
    if (!running) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [running]);
  return { batch, rows, summary, running };
}
export type LinkBatchHandle = ReturnType<typeof useLinkBatch>;

const lineCount = (text: string) => text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length;

interface Props {
  source: UrlSource;
  links: LinkBatchHandle;
  /** An outside reason the field cannot be used (a bookmarklet page is still on its way). */
  waiting?: boolean;
  placeholder?: string;
}

/** What one row says about itself. */
function rowText(t: ReturnType<typeof useT>, r: Row): string {
  switch (r.state) {
    case "waiting":
      return t("ingest.rowWaiting");
    case "working":
      return t("ingest.rowWorking");
    case "saved":
      return t("ingest.rowSaved");
    case "duplicate":
      return t("ingest.rowDuplicate");
    case "link":
      return t("ingest.rowLink", { reason: r.reason ? lm(r.reason) : t("srv.pageNotReadHere") });
    case "skipped":
      return r.error === "scheme" ? t("ingest.rowScheme") : t("ingest.rowInvalid");
    default:
      return lm(r.error ?? "");
  }
}

function Dot({ state }: { state: Row["state"] }) {
  if (state === "saved" || state === "link" || state === "duplicate") return <Check size={12} aria-hidden="true" />;
  if (state === "failed" || state === "skipped") return <X size={12} aria-hidden="true" />;
  if (state === "working") return <span className="size-2 animate-pulse rounded-full bg-current" />;
  return null;
}

/** Counts, the link being read, the outcome of each link, retry for the ones that failed, and a closing summary. */
export function LinkResults({ links }: { links: LinkBatchHandle }) {
  const t = useT();
  const { batch, rows, summary: s, running } = links;
  const count = (key: Parameters<typeof t>[0], n: number, name: string) => (
    <span data-count={name} className="whitespace-nowrap">
      <b className="font-semibold tabular-nums text-ink">{n}</b> {t(key)}
    </span>
  );
  const box = useRef<HTMLElement>(null);
  // The list opens below the box: bring it into view when it first appears, so the reader sees the batch start.
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <section ref={box} aria-label={t("ingest.resultsLabel")} data-link-results className="mt-4 rounded-[16px] border border-rule bg-raised p-3.5 text-left">
      <div role="status" aria-live="polite" data-batch-status className="text-[13px] text-ink-3">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {count("ingest.cTotal", s.total, "total")}
          {count("ingest.cSaved", s.saved, "saved")}
          {count("ingest.cExisting", s.duplicate, "existing")}
          {count("ingest.cFailed", s.failed, "failed")}
          {s.skipped ? count("ingest.cSkipped", s.skipped, "skipped") : null}
        </p>
        {s.current ? (
          <p data-batch-current className="mt-1.5 truncate text-[12.5px]">
            {t("ingest.currentLink", { url: s.current })}
          </p>
        ) : null}
        {s.done ? (
          <p data-batch-finished className="mt-2 text-[13px] text-ink-2">
            {t("ingest.finished", { saved: s.saved, existing: s.duplicate, failed: s.failed, skipped: s.skipped })}
          </p>
        ) : null}
      </div>
      <ul className="add-rows scroll-thin" aria-label={t("ingest.resultsLabel")}>
        {rows.map((r) => (
          <li key={r.id} data-state={r.state === "saved" || r.state === "link" || r.state === "duplicate" ? "saved" : r.state === "failed" || r.state === "skipped" ? "failed" : "pending"} data-row={r.state}>
            <span className="add-dot">
              <Dot state={r.state} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-2">{r.title ?? r.url}</span>
              <span className={`block text-[12px] leading-snug ${r.state === "failed" || r.state === "skipped" ? "text-rubric-text" : "text-ink-3"}`}>{rowText(t, r)}</span>
            </span>
            {r.slug && r.state !== "waiting" && r.state !== "working" ? (
              <Link href={`/read/${r.slug}`} className="shrink-0 text-[12.5px] font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                {t("common.open")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {!running && s.done ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {s.failed ? (
            <button type="button" data-retry-failed className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 font-medium text-bg transition-[opacity,transform] active:scale-[0.97]" onClick={() => batch.retryFailed()}>
              <RotateCcw size={13} aria-hidden="true" /> {t("ingest.retryFailed", { n: s.failed })}
            </button>
          ) : null}
          {s.saved + s.duplicate ? (
            <Link href="/library" className="font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
              {t("ingest.openLibrary")}
            </Link>
          ) : null}
          <button type="button" className="text-ink-3 underline decoration-rule-strong underline-offset-4 hover:text-ink" onClick={() => batch.clear()}>
            {t("ingest.clearResults")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The home page's link box: one or many links, one per line. A single line behaves as it always did (the page is read and the reader opens); several
 * lines are read in turn and stay on this page with their results. Only the line breaks separate links.
 */
export const LinksField = forwardRef(function LinksField({ source, links, waiting, placeholder }: Props, ref: Ref<HTMLTextAreaElement>) {
  const t = useT();
  const hintId = useId();
  const statusId = useId();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const { url: text, setUrl, busy, setTouched } = source;
  // Set once the page has hydrated: before that the box is only server-rendered markup, and anything typed into it is lost when React takes over.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  const working = busy === "url" || busy === "page" || !!waiting;
  const locked = working || links.running;
  const lines = lineCount(text);
  const multi = lines > 1;
  const parsed = useMemo(() => (multi ? parseLinks(text) : null), [multi, text]);

  // The box grows with what is pasted, up to a few lines; past that it scrolls.
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const submit = () => {
    if (locked) return;
    if (!text.trim()) {
      inner.current?.focus();
      return;
    }
    if (!multi) {
      void source.submit();
      return;
    }
    // Several lines: nothing is sent unless at least one is an address; the text stays so the rest can be fixed.
    if (parsed && links.batch.start(parsed) && parsed.urls.length) setUrl("");
  };

  const hints: string[] = [];
  if (parsed) {
    if (parsed.urls.length) hints.push(t("ingest.linksReady", { n: parsed.urls.length }));
    if (parsed.invalid.length) hints.push(t("ingest.linksSkipped", { n: parsed.invalid.length }));
    if (parsed.repeated) hints.push(t("ingest.linksRepeated", { n: parsed.repeated }));
    if (parsed.over) hints.push(t("ingest.linksOver", { n: parsed.over, max: MAX_LINKS }));
  }
  const singleProblem = !multi ? undefined : null; // several lines are judged line by line, never as one address
  const invalidNow = !multi && !!source.problem && (source.touched || text.trim().length > 6);

  return (
    <div className="w-full text-left">
      <form
        className={`import-bar relative flex items-end gap-2 overflow-hidden rounded-[18px] border bg-raised p-1.5 shadow-card max-sm:flex-col max-sm:items-stretch transition-[border-color,box-shadow] duration-300 focus-within:border-rule-strong focus-within:shadow-pop ${
          locked ? "border-rule-strong" : source.error ? "border-[var(--rubric)]" : "border-rule"
        }`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Link2 size={18} aria-hidden="true" className="pointer-events-none absolute left-[18px] top-[18px] text-ink-3" />
        <textarea
          ref={setRef}
          value={text}
          rows={2}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            // Enter reads a single link, as it always did; once there are several lines it starts a new one, and Ctrl or ⌘ + Enter reads them all.
            if (e.ctrlKey || e.metaKey || !multi) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={waiting ? t("landing.linkWaiting") : (placeholder ?? "https://example.com/article-1\nhttps://example.com/article-2")}
          aria-label={t("ingest.linksLabel")}
          aria-invalid={invalidNow ? true : undefined}
          aria-describedby={`${hintId} ${statusId}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-links-input
          data-hydrated={hydrated ? "" : undefined}
          disabled={locked}
          className="min-h-[72px] min-w-0 flex-1 resize-none bg-transparent py-3 pl-[46px] pr-2 text-[16px] leading-[1.5] text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none disabled:text-ink-2"
        />
        <button
          type="submit"
          disabled={locked}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[13px] bg-ink px-4 text-[14.5px] font-medium text-bg transition-[opacity,transform] focus-visible:outline-offset-[-4px] focus-visible:outline-bg active:scale-[0.97] disabled:opacity-30 sm:px-5"
        >
          <span>{locked ? t("common.reading") : t("ingest.readLinks")}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        {working ? <span className="import-progress" aria-hidden="true" /> : null}
      </form>
      <p id={hintId} className="mt-3 text-center text-[13.5px] text-ink-2">
        {t("ingest.linksHint")}
        <span className="hidden sm:block mt-1 text-[12px] text-ink-4">{t("ingest.linksKeys")}</span>
      </p>
      <div id={statusId} role="status" aria-live="polite" data-url-status className="mt-2 min-h-[20px] px-1 text-center text-[13px] leading-snug [&>p]:justify-center">
        {hints.length ? <p className="text-ink-3">{hints.join(" ")}</p> : <UrlStatus source={source} working={working} showSupport={!links.rows.length} problemOverride={singleProblem} />}
      </div>
      {links.rows.length ? <LinkResults links={links} /> : null}
    </div>
  );
});
