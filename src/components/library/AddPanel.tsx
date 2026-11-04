"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, BookmarkPlus, Check, Copy, FileUp, Link2, TextCursorInput, X } from "lucide-react";
import { TopicGlyph } from "./TopicGlyph";
import { ACCEPT, bookmarklet, useImport } from "@/lib/client/import";
import { UrlField, useUrlSource } from "@/components/ingest/UrlField";
import { useLinkBatch } from "@/components/ingest/LinksField";
import { parseLinks } from "@/lib/client/linkBatch";
import { handleFiles } from "@/lib/client/importQueue";
import { PasteDialog } from "@/components/landing/PasteDialog";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { useT } from "@/i18n/client";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";

export function AddPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (count: number) => void }) {
  const t = useT();
  const [tab, setTab] = useState<"agent" | "links">("links");
  const [text, setText] = useState("");
  // Several links at once go through the same engine as the home page: one at a time, each with its own outcome.
  const links = useLinkBatch();
  const busy = links.running;
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(dialogRef);
  const docRef = useRef<HTMLInputElement>(null);
  const [origin, setOrigin] = useState("");
  const imp = useImport("read");
  // The panel is opened from the library and from the top bar: a link added here stays on this page and shows up on the shelf.
  const source = useUrlSource("stay");
  useEffect(() => {
    // The bookmarklets name this page's address, which only the browser knows.
    const id = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pasteOpen) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, pasteOpen]);

  const parsed = useMemo(() => parseLinks(text), [text]);
  const urls = parsed.urls;

  const save = () => {
    if (!urls.length) return;
    if (links.batch.start(parsed)) setText("");
  };

  // The shelf is told once per finished batch, with how many links were kept.
  const told = useRef(false);
  useEffect(() => {
    if (links.running) told.current = false;
    else if (links.summary.done && !told.current) {
      told.current = true;
      onSaved(links.summary.saved);
    }
  }, [links.running, links.summary.done, links.summary.saved, onSaved]);

  const importExport = async (file: File) => {
    const t = await file.text();
    const found = Array.from(t.matchAll(/https?:\/\/[^\s"'<>)]+/g)).map((m) => m[0]);
    setText([...new Set(found)].slice(0, 50).join("\n"));
  };

  const bm = (kind: "read" | "save") => bookmarklet(origin, kind);

  return (
    <div className="fixed inset-0 z-[85]">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_62%,transparent)] backdrop-blur-[6px]" style={{ animation: "fade .3s var(--ease-out)" }} onPointerDown={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("add.dialog")} className="add-panel scroll-thin">
        <div className="flex items-center justify-between gap-3">
          <div className="lib-sort !ml-0" role="tablist" aria-label={t("add.tabs")}>
            <button type="button" role="tab" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>
              {t("add.tabAgent")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>
              {t("add.tabLinks")}
            </button>
          </div>
          <button type="button" aria-label={t("common.close")} data-tip={t("common.close")} data-tip-kbd="Esc" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        {tab === "agent" ? (
          <div className="mt-5">
            <div className="flex items-start gap-3.5">
              <TopicGlyph topic="ai" size={46} />
              <div>
                <p className="font-serif text-[19px] leading-tight text-ink">{t("add.agentTitle")}</p>
                <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">{t("add.agentBody")}</p>
              </div>
            </div>
            <p className="mt-4 text-[13.5px] text-ink-2">{t("add.agentUntil")}</p>
          </div>
        ) : (
          <div className="mt-5">
            <p className="font-serif text-[21px] leading-tight text-ink">{t("ingest.heading")}</p>
            <section className="mt-4" aria-labelledby="add-link-h">
              <p id="add-link-h" className="lib-label">
                {t("ingest.linkHeading")}
              </p>
              <div className="mt-2">
                <UrlField source={source} size="panel" autoFocus showSupport placeholder={t("ingest.linkShort")} />
              </div>
            </section>
            <section className="mt-3" aria-labelledby="add-file-h">
              <p id="add-file-h" className="lib-label">
                {t("ingest.fileHeading")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[14px] border border-dashed border-rule-strong px-4 py-3.5">
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-raised px-3.5 text-[13.5px] text-ink-2 transition-colors hover:border-rule-strong hover:text-ink" onClick={() => docRef.current?.click()}>
                  <FileUp size={15} aria-hidden="true" /> {t("ingest.uploadButton")}
                </button>
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-raised px-3.5 text-[13.5px] text-ink-2 transition-colors hover:border-rule-strong hover:text-ink" onClick={() => setPasteOpen(true)}>
                  <TextCursorInput size={15} aria-hidden="true" /> {t("common.pasteText")}
                </button>
                <p className="min-w-0 basis-full text-[12.5px] leading-snug text-ink-4">
                  {t("ingest.fileHelp")}
                </p>
              </div>
            </section>
            <details className="mt-4 text-[13px]">
              <summary className="cursor-pointer select-none text-ink-3 hover:text-ink-2">{t("ingest.severalLinks")}</summary>
              <div className="mt-3">
            <p className="font-serif text-[19px] leading-tight text-ink">{t("add.linksTitle")}</p>
            <p className="mt-1 text-[13px] text-ink-3">
              {t("add.linksHelp")}{" "}
              <button type="button" className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink" onClick={() => fileRef.current?.click()}>
                {t("add.dropExport")}
              </button>
              .
            </p>
            <input ref={fileRef} type="file" accept=".csv,.html,.htm,.txt,.json,text/csv,text/html,text/plain,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importExport(e.target.files[0])} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"https://paulgraham.com/greatwork.html\nhttps://..."} rows={4} className="add-text" aria-label={t("add.linksLabel")} />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ink-4">{urls.length ? t("add.linkCount", { n: urls.length }) : ""}</span>
              <button type="button" disabled={!urls.length || busy} className="add-btn" onClick={save}>
                {busy ? t("add.saving") : t("common.save")}
              </button>
            </div>
            {links.rows.length ? (
              <ul className="add-rows">
                {links.rows.map((r) => {
                  const state = r.state === "saved" || r.state === "link" || r.state === "duplicate" ? "saved" : r.state === "failed" || r.state === "skipped" ? "failed" : "pending";
                  const error = r.state === "skipped" ? t(r.error === "scheme" ? "ingest.rowScheme" : "ingest.rowInvalid") : r.state === "failed" ? lm(r.error ?? "") : null;
                  const note = r.state === "link" ? `${t("add.savedAsLink")} ${r.reason ? lm(r.reason) : ""}`.trim() : r.state === "duplicate" ? t("ingest.rowDuplicate") : null;
                  return (
                    <li key={r.id} data-state={state}>
                      <span className="add-dot">{state === "saved" ? <Check size={12} aria-hidden="true" /> : state === "failed" ? <X size={12} aria-hidden="true" /> : <span className="size-2 animate-pulse rounded-full bg-current" />}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{r.title ?? r.url}</span>
                      {error ? <span className="min-w-0 flex-[2] text-[12px] leading-snug text-rubric-text">{error}</span> : null}
                      {note ? <span className="min-w-0 flex-[2] text-[12px] leading-snug text-ink-3">{note}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
              </div>
            </details>
            <input
              ref={docRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              aria-label={t("add.filesLabel")}
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files, (f) => void imp.importFile(f));
                e.target.value = "";
              }}
            />
            <div className="mt-6 border-t border-rule pt-5">
              <p className="lib-label">{t("add.fromAnyPage")}</p>
              <p className="mt-1 text-[13px] text-ink-3">{t("add.bookmarkletHelp")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a data-tip={t("add.dragTip")} className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing" href={bm("read")} onClick={(e) => e.preventDefault()}>
                  <BookOpen size={14} aria-hidden="true" className="text-ink-3" /> {t("add.readIn")}
                </a>
                <a data-tip={t("add.dragTip")} className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing" href={bm("save")} onClick={(e) => e.preventDefault()}>
                  <BookmarkPlus size={14} aria-hidden="true" className="text-ink-3" /> {t("add.saveTo")}
                </a>
              </div>
              <details className="mt-3 text-[12.5px] text-ink-3">
                <summary className="cursor-pointer select-none hover:text-ink-2">{t("add.onPhone")}</summary>
                <div className="mt-2">
                  <div className="rounded-[14px] border border-rule bg-bg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">{t("add.phoneTitle")}</p>
                        <p className="text-[12px] text-ink-3">{t("add.phoneHelp")}</p>
                      </div>
                      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink" onClick={() => void navigator.clipboard?.writeText(bm("save"))}>
                        <Copy size={12} aria-hidden="true" />
                        {t("add.copy")}
                      </button>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunk px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">{bm("save")}</pre>
                  </div>
                </div>
              </details>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-snug text-ink-4">
              <Link2 size={12} aria-hidden="true" className="mt-0.5 shrink-0" /> {t("add.serverNote")}
            </p>
          </div>
        )}
      </section>
      {pasteOpen ? (
        <PasteDialog
          busy={!!imp.busy}
          error={imp.error}
          onClose={() => setPasteOpen(false)}
          onRead={async (t) => {
            if (await imp.importText(t)) setPasteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
