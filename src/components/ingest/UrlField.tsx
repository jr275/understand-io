"use client";

import { forwardRef, useCallback, useId, useRef, useState, type Ref } from "react";
import { ArrowRight, Check, Link2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { looksLikeUrl, normaliseUrl, urlProblem, useImport, type After, type ImportOutcome } from "@/lib/client/import";
import { useT } from "@/i18n/client";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";

/**
 * One address field for every place that adds a link (the home page, the Add panel, the library). It owns no ingestion of its own: `useImport` sends
 * the link to the same `/api/import` every other entry point uses. The hook keeps the typed text so the callers that need more than the field (the
 * home page also listens for pastes anywhere) can share one `useImport`.
 */
export function useUrlSource(after: After, initial = "") {
  const imp = useImport(after, { inline: true });
  const [url, setUrlState] = useState(initial);
  // An address is only called wrong once the reader has stopped typing it (blur) or tried to send it: no red text while they are still typing.
  const [touched, setTouched] = useState(false);
  const { reset, importUrl } = imp;

  const setUrl = useCallback(
    (v: string) => {
      setUrlState(v);
      reset();
    },
    [reset],
  );

  const problem = url.trim() ? urlProblem(url) : null;
  const canSend = looksLikeUrl(url) && !imp.busy;

  const submit = useCallback(async () => {
    setTouched(true);
    if (!url.trim() || urlProblem(url) || imp.busy) return false;
    const ok = await importUrl(normaliseUrl(url));
    // The reader stays on this page for "stay": the field is ready for the next address. For "read" the page is about to change.
    if (ok && after === "stay") {
      setUrlState("");
      setTouched(false);
    }
    return ok;
  }, [after, imp.busy, importUrl, url]);

  return { ...imp, url, setUrl, problem, touched, setTouched, canSend, submit };
}

export type UrlSource = ReturnType<typeof useUrlSource>;
type Source = UrlSource;

interface Props {
  source: Source;
  /** `hero` is the large field of the home page; `panel` sits inside a dialog or beside the library. */
  size?: "hero" | "panel";
  /** Label of the button; defaults to Add. The home page says Read, because it opens the text. */
  action?: string;
  busyAction?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** An outside reason the field cannot be used (a bookmarklet page is still on its way). */
  waiting?: boolean;
  /** Only the home page shows the formats line itself; panels show it with the file section. */
  showSupport?: boolean;
}

/** What the last import did, next to the field, in words a reader can act on. */
function Outcome({ last }: { last: ImportOutcome }) {
  const t = useT();
  const { document: d } = last;
  const text = last.kind === "added" ? t("ingest.added", { title: d.title }) : last.kind === "duplicate" ? t("ingest.duplicate", { title: d.title }) : t("ingest.linkOnly", { reason: last.reason ? lm(last.reason) : t("srv.pageNotReadHere") });
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
      <Check size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
      <span className="min-w-0">{text}</span>
      <Link href={`/read/${d.slug}`} className="shrink-0 font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
        {t("common.open")}
      </Link>
    </p>
  );
}

/** The one sentence under a link field: what is happening, what is wrong, or what was added (see `useUrlSource`). */
export function UrlStatus({ source, working, showSupport, problemOverride }: { source: Source; working: boolean; showSupport?: boolean; problemOverride?: "scheme" | "invalid" | null }) {
  const t = useT();
  const { url, error, last, problem, touched, submit } = source;
  const shown = problemOverride !== undefined ? problemOverride : problem && (touched || url.trim().length > 6) ? problem : null;
  if (working) return <p className="text-ink-3">{t("ingest.working")}</p>;
  if (shown) return <p className="text-rubric-text">{t(shown === "scheme" ? "ingest.scheme" : "ingest.invalid")}</p>;
  if (error) {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-rubric-text">
        <span className="min-w-0">{lm(error)}</span>
        <button type="button" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink" onClick={() => void submit()}>
          <RotateCcw size={13} aria-hidden="true" /> {t("ingest.retry")}
        </button>
      </p>
    );
  }
  if (last) return <Outcome last={last} />;
  if (showSupport) return <p className="text-ink-4">{t("ingest.linkSupport")}</p>;
  return null;
}

export const UrlField = forwardRef(function UrlField({ source, size = "panel", action, busyAction, placeholder, autoFocus, waiting, showSupport }: Props, ref: Ref<HTMLInputElement>) {
  const t = useT();
  const statusId = useId();
  const inner = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const { url, setUrl, busy, error, problem, touched, setTouched, submit } = source;
  const working = busy === "url" || busy === "page" || !!waiting;
  const shownProblem = problem && (touched || url.trim().length > 6) ? problem : null;
  const hero = size === "hero";
  const label = working ? (busyAction ?? t("ingest.adding")) : (action ?? t("ingest.add"));
  const status = <UrlStatus source={source} working={working} showSupport={showSupport} />;

  return (
    <div className="w-full text-left">
      <form
        className={`import-bar relative flex items-center gap-2 overflow-hidden border bg-raised transition-[border-color,box-shadow] duration-300 focus-within:border-rule-strong focus-within:shadow-pop ${
          hero ? "rounded-[18px] p-1.5 pl-[18px] shadow-card" : "rounded-[14px] p-1 pl-3.5"
        } ${shownProblem || error ? "border-[var(--rubric)]" : working ? "border-rule-strong" : "border-rule"}`}
        onSubmit={(e) => {
          e.preventDefault();
          // The button is never greyed out while the field is empty: pressing it then takes the reader to the field, which is what they wanted.
          if (!url.trim()) inner.current?.focus();
          else void submit();
        }}
      >
        <Link2 size={hero ? 18 : 16} aria-hidden="true" className="shrink-0 text-ink-3" />
        <input
          ref={setRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder ?? t("landing.linkPlaceholder")}
          aria-label={t("landing.linkLabel")}
          aria-invalid={shownProblem ? true : undefined}
          aria-describedby={statusId}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-autofocus={autoFocus ? "" : undefined}
          disabled={working}
          className={`min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none disabled:text-ink-2 ${hero ? "h-12" : "h-10"}`}
        />
        <button
          type="submit"
          disabled={working}
          className={`inline-flex shrink-0 items-center gap-2 bg-ink font-medium text-bg transition-[opacity,transform] focus-visible:outline-offset-[-4px] focus-visible:outline-bg active:scale-[0.97] disabled:opacity-30 ${
            hero ? "h-12 rounded-[13px] px-4 text-[14.5px] sm:px-5" : "h-10 rounded-[10px] px-3.5 text-[14px]"
          }`}
        >
          <span>{label}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        {working ? <span className="import-progress" aria-hidden="true" /> : null}
      </form>
      <div id={statusId} role="status" aria-live="polite" data-url-status className={`mt-2.5 min-h-[20px] px-1 text-[13px] leading-snug ${hero ? "text-center [&>p]:justify-center" : ""}`}>
        {status}
      </div>
    </div>
  );
});
