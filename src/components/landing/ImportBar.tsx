"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileUp, Link2, TextCursorInput, X } from "lucide-react";
import { looksLikeUrl, normaliseUrl, useImport } from "@/lib/client/import";

export const ACCEPT = ".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown";

export function ImportBar({ initialUrl }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, importUrl, importText, importFile } = useImport();
  const started = useRef(false);

  // Bookmarklet entry: /?url=…
  useEffect(() => {
    if (initialUrl && !started.current) {
      started.current = true;
      void importUrl(normaliseUrl(initialUrl));
    }
  }, [initialUrl, importUrl]);

  // ⌘V / Ctrl+V anywhere: a URL opens it, longer text becomes a document.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      const file = e.clipboardData?.files?.[0];
      if (file) {
        e.preventDefault();
        void importFile(file);
        return;
      }
      if (!text) return;
      e.preventDefault();
      if (looksLikeUrl(text)) {
        setUrl(text);
        void importUrl(normaliseUrl(text));
      } else if (text.length > 40) {
        void importText(text);
      } else {
        setPasted(text);
        setPasteOpen(true);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [importFile, importText, importUrl]);

  const canRead = looksLikeUrl(url) && !busy;

  return (
    <div className="mt-10 w-full max-w-[600px] text-left sm:mt-12">
      <form
        className={`import-bar relative flex items-center gap-2 overflow-hidden rounded-[18px] border bg-raised p-1.5 pl-[18px] shadow-card transition-[border-color,box-shadow] duration-300 focus-within:border-rule-strong focus-within:shadow-pop ${
          busy === "url" ? "border-rule-strong" : "border-rule"
        }`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canRead) void importUrl(normaliseUrl(url));
        }}
      >
        <Link2 size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a link to any article"
          aria-label="Article link"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          disabled={busy === "url"}
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none disabled:text-ink-2"
        />
        <button
          type="submit"
          disabled={!canRead}
          aria-label="Read"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-[13px] bg-ink px-4 text-[14.5px] font-medium text-bg transition-[opacity,transform] focus-visible:outline-offset-[-4px] focus-visible:outline-bg active:scale-[0.97] disabled:opacity-30 sm:px-5"
        >
          <span className="hidden sm:inline">{busy === "url" ? "Reading…" : "Read"}</span> <ArrowRight size={16} aria-hidden="true" />
        </button>
        {busy ? <span className="import-progress" aria-hidden="true" /> : null}
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] text-ink-3">
        <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink" onClick={() => fileRef.current?.click()}>
          <FileUp size={15} aria-hidden="true" /> Open a PDF
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink" onClick={() => setPasteOpen(true)}>
          <TextCursorInput size={15} aria-hidden="true" /> Paste text
        </button>
        <span className="hidden items-center gap-1.5 text-ink-4 sm:inline-flex">
          or press <kbd>⌘</kbd>
          <kbd>V</kbd> anywhere
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Open a file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      {pasteOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4" onPointerDown={(e) => e.target === e.currentTarget && setPasteOpen(false)}>
          <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[3px]" />
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Paste text"
            className="pop relative w-full max-w-[560px] p-5"
            style={{ ["--origin" as string]: "center" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim().length) {
                setPasteOpen(false);
                void importText(pasted);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-[19px] leading-tight text-ink">Paste text</p>
                <p className="mt-1 text-[13px] text-ink-3">A chapter, an essay, notes. Gloss will set it like an article.</p>
              </div>
              <button type="button" aria-label="Close" className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={() => setPasteOpen(false)}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <textarea
              autoFocus
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={9}
              placeholder="Paste anything…"
              aria-label="Text to read"
              className="add-text font-serif text-[15px]"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ink-4">{pasted.trim() ? `${pasted.trim().split(/\s+/).length} words` : ""}</span>
              <button type="submit" disabled={!pasted.trim() || !!busy} className="add-btn">
                Read <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
