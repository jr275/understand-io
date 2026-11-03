"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, TextCursorInput } from "lucide-react";
import { ACCEPT, looksLikeUrl, normaliseUrl } from "@/lib/client/import";
import { useUrlSource } from "@/components/ingest/UrlField";
import { LinksField, useLinkBatch } from "@/components/ingest/LinksField";
import { parseLinks } from "@/lib/client/linkBatch";
import { handleFiles } from "@/lib/client/importQueue";
import { toast } from "@/lib/store/toast";
import { PasteDialog } from "./PasteDialog";
import { useT } from "@/i18n/client";

export { ACCEPT };

interface Props {
  /** `/?url=…` or `/?save=…`: only fills the field. Reading starts when the reader presses Read, never from the link itself. */
  initialUrl?: string;
  /** Bookmarklet entry `/?capture=read|save`: wait for the opener tab to post the page HTML. */
  capture?: "read" | "save";
}

const CAPTURE_WAIT_MS = 6000;

function originOf(raw: string | undefined) {
  try {
    return raw ? new URL(normaliseUrl(raw)).origin : null;
  } catch {
    return null;
  }
}

export function ImportBar({ initialUrl, capture }: Props) {
  const t = useT();
  // The capture handshake below must not restart when the language changes, so it reads the translator through a ref.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [waiting, setWaiting] = useState(!!capture);
  // The shortcut key is named after the reader's system; the server cannot know it, so the first paint says Ctrl and a Mac then says ⌘.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)), 0);
    return () => window.clearTimeout(id);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const links = useLinkBatch();
  const source = useUrlSource("read", initialUrl ?? "");
  const { busy, error, importUrl, importText, importFile, importPage, setUrl } = source;
  const started = useRef(false);

  // A link that arrives with a URL (`/?url=…`, `/?save=…`) is only a suggestion: it must never fetch or import on its own
  // (any site could link here and make this server fetch a page for the visitor). Fill the field and let the reader press Read.
  useEffect(() => {
    if (initialUrl && !capture) inputRef.current?.focus();
  }, [initialUrl, capture]);

  // Bookmarklet entry /?capture=…: the opener tab (the article) posts its HTML. Only a real opener is listened to, and what it
  // posts must come from the origin of the page it says it captured (a hostile page that opens this URL cannot pose as another site).
  // The effect is re-runnable (StrictMode runs effects twice in development): the listener and the fallback timer are
  // re-registered on every run, and `started` only guards the import itself.
  useEffect(() => {
    if (!capture) return;
    const after = capture === "save" ? "library" : "read";
    if (!window.opener) {
      // Opened directly, not by the bookmarklet: nothing will arrive. Behave like a plain link.
      const timer = window.setTimeout(() => {
        setWaiting(false);
        if (initialUrl) toast(tRef.current("landing.pressRead"), { ttl: 6000 });
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const expected = originOf(initialUrl);
    const onMessage = (e: MessageEvent) => {
      if (started.current || !window.opener || e.source !== window.opener) return;
      const d = e.data as { type?: string; url?: string; html?: string; title?: string } | null;
      if (!d || d.type !== "understand:page" || typeof d.html !== "string" || typeof d.url !== "string") return;
      let captured: URL;
      try {
        captured = new URL(d.url);
      } catch {
        return;
      }
      if (!/^https?:$/.test(captured.protocol) || captured.origin !== e.origin || (expected && captured.origin !== expected)) return;
      started.current = true;
      window.clearTimeout(timer);
      setUrl(d.url);
      setWaiting(false);
      void importPage({ url: d.url, html: d.html, title: d.title }, after);
    };
    window.addEventListener("message", onMessage);
    // Tell the opener we are listening; it answers with the page.
    try {
      window.opener.postMessage("understand:ready", expected ?? "*");
    } catch {
      /* the opener is gone or on another origin than the link says */
    }
    const timer = window.setTimeout(() => {
      if (started.current) return;
      setWaiting(false);
      // Never import on our own here either: the opener could be any page. The reader decides.
      toast(initialUrl ? tRef.current("landing.pageNoContentUrl") : tRef.current("landing.pageNoContentBookmarklet"), { ttl: 8000 });
      if (initialUrl) inputRef.current?.focus();
    }, CAPTURE_WAIT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [capture, initialUrl, importPage, setUrl]);

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
      // Several lines that are all addresses are a list of links to read, not a text to keep.
      const list = /\r?\n/.test(text) ? parseLinks(text) : null;
      if (list && list.urls.length + list.repeated > 1 && !list.invalid.length) {
        links.batch.start(list);
      } else if (looksLikeUrl(text)) {
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
  }, [importFile, importText, importUrl, setUrl, links.batch]);

  return (
    <div className="mt-9 w-full max-w-[640px] text-left sm:mt-12">
      <LinksField ref={inputRef} source={source} links={links} waiting={waiting} />
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13.5px] text-ink-2">
        <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-raised px-3.5 transition-colors hover:border-rule-strong hover:text-ink" onClick={() => fileRef.current?.click()}>
          <FileUp size={15} aria-hidden="true" /> {t("ingest.uploadButton")}
        </button>
        <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-raised px-3.5 transition-colors hover:border-rule-strong hover:text-ink" onClick={() => setPasteOpen(true)}>
          <TextCursorInput size={15} aria-hidden="true" /> {t("common.pasteText")}
        </button>
      </div>
      <p className="mt-3 hidden items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-4 sm:flex">
        {t("ingest.pressKey")} <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
        <kbd>V</kbd>
        {t("landing.hintAnywhere")}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        aria-label={t("common.openFiles")}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files, (f) => void importFile(f));
          e.target.value = "";
        }}
      />
      {pasteOpen ? (
        <PasteDialog
          initial={pasted}
          busy={!!busy}
          error={error}
          onClose={() => setPasteOpen(false)}
          onRead={async (text) => {
            setPasted(text);
            if (await importText(text)) setPasteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
