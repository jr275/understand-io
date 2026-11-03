"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { GlossDocument } from "@/lib/content/types";
import { ensureReader, getLibrary, rememberDocument, syncRemoteLibrary } from "@/lib/store/library";
import { findDuplicate } from "@/lib/store/duplicates";
import { toast } from "@/lib/store/toast";
import { track } from "@/lib/client/analytics";
import { tNow } from "@/i18n/runtime";
import { localizeServerMessage } from "@/i18n/serverMessages";

export interface ImportResult {
  document: GlossDocument;
  persisted: boolean;
  /** The page could not be read, so only the link was saved; `reason` says why. */
  linkOnly?: boolean;
  reason?: string;
  /** The server already had this text in the reader's library: `document` is the saved one and nothing new was created. */
  duplicate?: boolean;
}

/** What the last import of a `useImport` did, for the screen that started it to say so next to its own field. */
export interface ImportOutcome {
  kind: "added" | "duplicate" | "link";
  document: GlossDocument;
  /** For `link`: why the page itself could not be read. */
  reason?: string;
}

/** File types the import endpoints accept. */
export const ACCEPT =
  ".pdf,.txt,.md,.markdown,.docx,.epub,.html,.htm,.xhtml,application/pdf,text/plain,text/markdown,text/html,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Where to go once a document has been imported. */
export type After = "read" | "library" | "stay";

async function post(path: string, body: BodyInit, json = true, signal?: AbortSignal): Promise<ImportResult> {
  // A new visitor has no reader cookie yet. Two imports sent together (a batch) would each be given a different reader by the server, and
  // the one the browser does not keep would vanish from the library. One shared request settles the cookie first.
  await ensureReader();
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body, signal, headers: json ? { "content-type": "application/json" } : undefined });
  } catch (e) {
    // A cancelled batch stays a cancellation; any other failure to get an answer (offline, the server down) is said in words, not as the browser's "Failed to fetch".
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || `Request failed (${res.status}).`);
  return data as ImportResult;
}

/** Imports a URL, pasted text, a file or captured page HTML, remembers the document locally and opens the reader. */
export function useImport(defaultAfter: After = "read", opts: { inline?: boolean } = {}) {
  // `inline`: the screen shows the outcome next to its own field (see `UrlField`), so no toast repeats it where the reader stays on the page.
  const inline = !!opts.inline;
  const router = useRouter();
  const [busy, setBusy] = useState<null | "url" | "text" | "file" | "page">(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ImportOutcome | null>(null);

  const finish = useCallback(
    (r: ImportResult, after: After) => {
      rememberDocument(r.document, r.persisted);
      setLast({ kind: r.duplicate ? "duplicate" : r.linkOnly ? "link" : "added", document: r.document, reason: r.reason });
      if (r.duplicate) {
        // The server recognised the text: it is the one already on the shelf, so say so and open that one.
        if (!(inline && after === "stay")) toast(tNow("srv.alreadyInLibrary", { title: r.document.title }), { ttl: 6000, action: { label: tNow("common.open"), onClick: () => router.push(`/read/${r.document.slug}`) } });
        if (after === "read") router.push(`/read/${r.document.slug}`);
        else if (after === "library") router.push("/library");
        return;
      }
      if (r.linkOnly) {
        // Saved, but not readable here: say so and why, and go where the link's own page explains what can be done.
        if (!(inline && after === "stay")) toast(tNow("srv.savedLinkReason", { reason: r.reason ? localizeServerMessage(r.reason) : tNow("srv.pageNotReadHere") }), { ttl: 9000, action: { label: tNow("common.open"), onClick: () => router.push(`/read/${r.document.slug}`) } });
        if (after === "read") router.push(`/read/${r.document.slug}`);
        else if (after === "library") router.push("/library");
        else void syncRemoteLibrary();
        return;
      }
      if (after === "read") router.push(`/read/${r.document.slug}`);
      else if (after === "library") {
        toast(tNow("srv.shelved", { title: r.document.title }), { action: { label: tNow("common.read"), onClick: () => router.push(`/read/${r.document.slug}`) } });
        router.push("/library");
      } else {
        if (!(inline && after === "stay")) toast(tNow("srv.shelved", { title: r.document.title }), { action: { label: tNow("common.read"), onClick: () => router.push(`/read/${r.document.slug}`) } });
        void syncRemoteLibrary();
      }
    },
    [router, inline],
  );

  const run = useCallback(
    async (kind: NonNullable<typeof busy>, task: () => Promise<ImportResult>, after: After) => {
      setBusy(kind);
      setError(null);
      setLast(null);
      const source = kind === "url" ? "link" : kind === "text" ? "paste" : kind;
      try {
        const r = await task();
        // Counts, never contents: what kind of text, how it arrived, and whether it was new.
        track("import_completed", { source, outcome: r.duplicate ? "duplicate" : r.linkOnly ? "link_only" : "ok" });
        if (!r.duplicate) track("document_saved", { kind: r.document.kind === "sample" ? "text" : r.document.kind, via: kind === "page" ? "bookmarklet" : kind === "url" ? "link" : kind === "text" ? "paste" : "file" });
        finish(r, after);
        return true;
      } catch (e) {
        track("import_completed", { source, outcome: "failed" });
        const msg = e instanceof Error ? e.message : "Import failed.";
        setError(msg);
        if (!inline) toast(localizeServerMessage(msg), { ttl: 8000 });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [finish, inline],
  );

  /** The text is already on the shelf: say so and open it, instead of keeping a second copy. */
  const alreadyHere = useCallback(
    (d: GlossDocument, after: After) => {
      setError(null);
      setLast({ kind: "duplicate", document: d });
      if (!(inline && after === "stay")) toast(tNow("srv.alreadyInLibrary", { title: d.title }), { ttl: 6000, action: { label: tNow("common.open"), onClick: () => router.push(`/read/${d.slug}`) } });
      if (after === "read") router.push(`/read/${d.slug}`);
      return true;
    },
    [router, inline],
  );

  const importUrl = useCallback(
    (url: string, after: After = defaultAfter) => {
      const dup = findDuplicate(Object.values(getLibrary().docs), { url });
      return dup ? Promise.resolve(alreadyHere(dup, after)) : run("url", () => post("/api/import", JSON.stringify({ url, keep: true })), after);
    },
    [run, alreadyHere, defaultAfter],
  );
  const importText = useCallback(
    (text: string, title?: string, after: After = defaultAfter) => {
      const dup = findDuplicate(Object.values(getLibrary().docs), { text });
      return dup ? Promise.resolve(alreadyHere(dup, after)) : run("text", () => post("/api/import/text", JSON.stringify({ text, title })), after);
    },
    [run, alreadyHere, defaultAfter],
  );
  const importFile = useCallback(
    (file: File, after: After = defaultAfter) =>
      run("file", () => sendFile(file), after),
    [run, defaultAfter],
  );
  /** HTML captured in the reader's own browser (bookmarklet). */
  const importPage = useCallback(
    (page: { url: string; html: string; title?: string }, after: After = defaultAfter) => run("page", () => post("/api/import/page", JSON.stringify(page)), after),
    [run, defaultAfter],
  );

  const reset = useCallback(() => {
    setError(null);
    setLast(null);
  }, []);

  return { busy, error, last, reset, importUrl, importText, importFile, importPage };
}

export function looksLikeUrl(s: string) {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  // Any address with a scheme counts (an IP address, a port, a local name), and so does a bare domain.
  return /^https?:\/\/\S+$/i.test(t) || /^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t);
}

/**
 * Why a typed address cannot be opened, for saying so before anything is sent: `scheme` for an address that names another protocol (mailto:, ftp:,
 * javascript:), `invalid` for text that is not an address at all. Null when it can be tried (or when nothing was typed yet).
 */
export function urlProblem(s: string): null | "scheme" | "invalid" {
  const t = s.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t) && !/^[\w.-]+:\d+/.test(t)) return "scheme";
  return looksLikeUrl(t) ? null : "invalid";
}

export function normaliseUrl(s: string) {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** True when a file can be imported (PDF, plain text, markdown, Word, EPUB or a saved web page). */
export function isImportableFile(f: File) {
  return /pdf|text\/(plain|markdown|html)|epub|wordprocessingml|xhtml/.test(f.type) || /\.(pdf|txt|md|markdown|docx|epub|html?|xhtml)$/i.test(f.name);
}

/**
 * Sends one file to the server and answers what it answered. When the server kept the document (`persisted`) it is the only authority on
 * duplicates: a second opinion here could call a text a duplicate after the server had already stored it, leaving a copy nobody sees. Only
 * when the server has no database does the browser compare with its own shelf, so both modes behave alike.
 */
export async function sendFile(file: File, signal?: AbortSignal): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await post("/api/import/file", fd, false, signal);
  if (r.duplicate || r.linkOnly || r.persisted) return r;
  const text = r.document.blocks.map((b) => b.text).join("\n\n");
  const existing = findDuplicate(Object.values(getLibrary().docs), { text });
  return existing ? { document: existing, persisted: true, duplicate: true } : r;
}

export { bookmarklet } from "./bookmarklet";
