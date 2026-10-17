"use client";

import { useRef, useState } from "react";
import { ArrowRight, FileUp, Link2, TextCursorInput } from "lucide-react";
import { ACCEPT, looksLikeUrl, normaliseUrl, useImport } from "@/lib/client/import";
import { PasteDialog } from "@/components/landing/PasteDialog";

/** Compact “read something else” strip for the end of a text. */
export function QuickAdd() {
  const [url, setUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, importUrl, importFile, importText } = useImport();
  const canRead = looksLikeUrl(url) && !busy;
  return (
    <section aria-label="Read something else" className="focus-hide mt-10 rounded-[18px] border border-rule bg-raised p-4 sm:p-5">
      <p className="font-serif text-[19px] leading-tight text-ink">Read something else</p>
      <p className="mt-1 text-[13px] text-ink-3">Paste a link, open a PDF or drop a file anywhere on this page.</p>
      <form
        data-field
        className="mt-3 flex items-center gap-2 rounded-[14px] border border-rule bg-bg p-1 pl-3 focus-within:border-rule-strong"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRead) void importUrl(normaliseUrl(url));
        }}
      >
        <Link2 size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label="Link to read next" inputMode="url" autoComplete="off" spellCheck={false} disabled={busy === "url"} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4" />
        <button type="submit" disabled={!canRead} aria-label="Read this link" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-ink px-3 text-[13px] font-medium text-bg disabled:opacity-30">
          {busy === "url" ? "Reading…" : "Read"} <ArrowRight size={14} aria-hidden="true" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-3">
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} aria-hidden="true" /> Open a PDF
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => setPasteOpen(true)}>
          <TextCursorInput size={14} aria-hidden="true" /> Paste text
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Open a file to read next"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      {pasteOpen ? (
        <PasteDialog
          busy={!!busy}
          onClose={() => setPasteOpen(false)}
          onRead={(t) => {
            setPasteOpen(false);
            void importText(t);
          }}
        />
      ) : null}
    </section>
  );
}
