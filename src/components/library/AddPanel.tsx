"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, BookmarkPlus, Check, Copy, FileUp, Link2, TextCursorInput, X } from "lucide-react";
import { TopicGlyph } from "./TopicGlyph";
import { rememberDocument } from "@/lib/store/library";
import { ACCEPT, bookmarklet, useImport } from "@/lib/client/import";
import { handleFiles } from "@/lib/client/importQueue";
import { PasteDialog } from "@/components/landing/PasteDialog";
import { useModalFocus } from "@/lib/client/useModalFocus";

type Row = { url: string; state: "pending" | "saved" | "failed"; title?: string; error?: string; note?: string };

export function AddPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (count: number) => void }) {
  const [tab, setTab] = useState<"agent" | "links">("links");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(dialogRef);
  const docRef = useRef<HTMLInputElement>(null);
  const [origin, setOrigin] = useState("");
  const imp = useImport("read");
  useEffect(() => setOrigin(window.location.origin), []);
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

  const urls = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/\S+$/i.test(s) || /^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(s))
    .map((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`));

  const save = async () => {
    if (!urls.length) return;
    setBusy(true);
    const next: Row[] = urls.map((u) => ({ url: u, state: "pending" }));
    setRows(next);
    let saved = 0;
    for (let i = 0; i < next.length; i++) {
      try {
        const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: next[i].url, keep: true }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
        rememberDocument(j.document, j.persisted);
        saved++;
        setRows((r) => r.map((x, k) => (k === i ? { ...x, state: "saved", title: j.document.title, note: j.linkOnly ? `Saved as a link. ${j.reason ?? ""}`.trim() : undefined } : x)));
      } catch (e) {
        setRows((r) => r.map((x, k) => (k === i ? { ...x, state: "failed", error: e instanceof Error ? e.message : "Failed" } : x)));
      }
    }
    setBusy(false);
    setText("");
    onSaved(saved);
  };

  const importExport = async (file: File) => {
    const t = await file.text();
    const found = Array.from(t.matchAll(/https?:\/\/[^\s"'<>)]+/g)).map((m) => m[0]);
    setText([...new Set(found)].slice(0, 50).join("\n"));
  };

  const bm = (kind: "read" | "save") => bookmarklet(origin, kind);

  return (
    <div className="fixed inset-0 z-[85]">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_62%,transparent)] backdrop-blur-[6px]" style={{ animation: "fade .3s var(--ease-out)" }} onPointerDown={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Add to the library" className="add-panel scroll-thin">
        <div className="flex items-center justify-between gap-3">
          <div className="lib-sort !ml-0" role="tablist" aria-label="Add">
            <button type="button" role="tab" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>
              Connect an agent
            </button>
            <button type="button" role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>
              Save links manually
            </button>
          </div>
          <button type="button" aria-label="Close" data-tip="Close" data-tip-kbd="Esc" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        {tab === "agent" ? (
          <div className="mt-5">
            <div className="flex items-start gap-3.5">
              <TopicGlyph topic="ai" size={46} />
              <div>
                <p className="font-serif text-[19px] leading-tight text-ink">Let your agent shelve for you</p>
                <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">The reference product exposes an MCP server so an agent can save articles into your library. This build does not include an MCP server yet, so there is nothing to connect here.</p>
              </div>
            </div>
            <p className="mt-4 text-[13.5px] text-ink-2">Until then, the bookmarklets under “Save links manually” do the same job from any page.</p>
          </div>
        ) : (
          <div className="mt-5">
            <p className="font-serif text-[19px] leading-tight text-ink">Save links to your library</p>
            <p className="mt-1 text-[13px] text-ink-3">
              One or many, a line each. Understand.io reads each page in. PDFs work too. Leaving Pocket, Instapaper or Raindrop?{" "}
              <button type="button" className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink" onClick={() => fileRef.current?.click()}>
                Drop its export here
              </button>
              .
            </p>
            <input ref={fileRef} type="file" accept=".csv,.html,.htm,.txt,.json,text/csv,text/html,text/plain,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importExport(e.target.files[0])} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"https://paulgraham.com/greatwork.html\nhttps://..."} rows={4} className="add-text" aria-label="Links to save" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ink-4">{urls.length ? `${urls.length} link${urls.length === 1 ? "" : "s"}` : ""}</span>
              <button type="button" disabled={!urls.length || busy} className="add-btn" onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
            {rows.length ? (
              <ul className="add-rows">
                {rows.map((r) => (
                  <li key={r.url} data-state={r.state}>
                    <span className="add-dot">{r.state === "saved" ? <Check size={12} aria-hidden="true" /> : r.state === "failed" ? <X size={12} aria-hidden="true" /> : <span className="size-2 animate-pulse rounded-full bg-current" />}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{r.title ?? r.url}</span>
                    {r.error ? <span className="min-w-0 flex-[2] text-[12px] leading-snug text-rubric-text">{r.error}</span> : null}
                    {r.note ? <span className="min-w-0 flex-[2] text-[12px] leading-snug text-ink-3">{r.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-ink-3">
              <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink" onClick={() => docRef.current?.click()}>
                <FileUp size={15} aria-hidden="true" /> Open files
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink" onClick={() => setPasteOpen(true)}>
                <TextCursorInput size={15} aria-hidden="true" /> Paste text
              </button>
            </div>
            <input
              ref={docRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              aria-label="Open PDF, text, Word, EPUB or HTML files"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files, (f) => void imp.importFile(f));
                e.target.value = "";
              }}
            />
            <div className="mt-6 border-t border-rule pt-5">
              <p className="lib-label">From any page</p>
              <p className="mt-1 text-[13px] text-ink-3">Drag one to your bookmarks bar, then click it on any article. The page is read from your own browser tab, so it works on sites that block servers, and on anything you are signed in to.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a data-tip="Drag me to your bookmarks bar" className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing" href={bm("read")} onClick={(e) => e.preventDefault()}>
                  <BookOpen size={14} aria-hidden="true" className="text-ink-3" /> Read in Understand
                </a>
                <a data-tip="Drag me to your bookmarks bar" className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing" href={bm("save")} onClick={(e) => e.preventDefault()}>
                  <BookmarkPlus size={14} aria-hidden="true" className="text-ink-3" /> Save to Understand
                </a>
              </div>
              <details className="mt-3 text-[12.5px] text-ink-3">
                <summary className="cursor-pointer select-none hover:text-ink-2">On a phone</summary>
                <div className="mt-2">
                  <div className="rounded-[14px] border border-rule bg-bg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">Bookmark any page, then edit the bookmark</p>
                        <p className="text-[12px] text-ink-3">Paste this as its address and name it Save to Understand.</p>
                      </div>
                      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink" onClick={() => void navigator.clipboard?.writeText(bm("save"))}>
                        <Copy size={12} aria-hidden="true" />
                        Copy
                      </button>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunk px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">{bm("save")}</pre>
                  </div>
                </div>
              </details>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-snug text-ink-4">
              <Link2 size={12} aria-hidden="true" className="mt-0.5 shrink-0" /> Links pasted here are fetched by this server and read with Readability. Some publishers refuse server requests; for those, use the bookmarklet or paste the text.
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
