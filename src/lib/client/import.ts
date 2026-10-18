"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { GlossDocument } from "@/lib/content/types";
import { rememberDocument, syncRemoteLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";

export interface ImportResult {
  document: GlossDocument;
  persisted: boolean;
  /** The page could not be read, so only the link was saved; `reason` says why. */
  linkOnly?: boolean;
  reason?: string;
}

/** File types the import endpoints accept. */
export const ACCEPT = ".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown";

/** Where to go once a document has been imported. */
export type After = "read" | "library" | "stay";

async function post(path: string, body: BodyInit, json = true): Promise<ImportResult> {
  const res = await fetch(path, { method: "POST", body, headers: json ? { "content-type": "application/json" } : undefined });
  const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || `Import failed (${res.status}).`);
  return data as ImportResult;
}

/** Imports a URL, pasted text, a file or captured page HTML, remembers the document locally and opens the reader. */
export function useImport(defaultAfter: After = "read") {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "url" | "text" | "file" | "page">(null);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    (r: ImportResult, after: After) => {
      rememberDocument(r.document, r.persisted);
      if (r.linkOnly) {
        // Saved, but not readable here: say so and why, and go where the link's own page explains what can be done.
        toast(`Saved the link. ${r.reason ?? "The page could not be read here."}`, { ttl: 9000, action: { label: "Open", onClick: () => router.push(`/read/${r.document.slug}`) } });
        if (after === "read") router.push(`/read/${r.document.slug}`);
        else if (after === "library") router.push("/library");
        else void syncRemoteLibrary();
        return;
      }
      if (after === "read") router.push(`/read/${r.document.slug}`);
      else if (after === "library") {
        toast(`Shelved “${r.document.title}”.`, { action: { label: "Read", onClick: () => router.push(`/read/${r.document.slug}`) } });
        router.push("/library");
      } else {
        toast(`Shelved “${r.document.title}”.`, { action: { label: "Read", onClick: () => router.push(`/read/${r.document.slug}`) } });
        void syncRemoteLibrary();
      }
    },
    [router],
  );

  const run = useCallback(
    async (kind: NonNullable<typeof busy>, task: () => Promise<ImportResult>, after: After) => {
      setBusy(kind);
      setError(null);
      try {
        finish(await task(), after);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Import failed.";
        setError(msg);
        toast(msg, { ttl: 8000 });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [finish],
  );

  const importUrl = useCallback((url: string, after: After = defaultAfter) => run("url", () => post("/api/import", JSON.stringify({ url, keep: true })), after), [run, defaultAfter]);
  const importText = useCallback((text: string, title?: string, after: After = defaultAfter) => run("text", () => post("/api/import/text", JSON.stringify({ text, title })), after), [run, defaultAfter]);
  const importFile = useCallback(
    (file: File, after: After = defaultAfter) =>
      run(
        "file",
        () => {
          const fd = new FormData();
          fd.append("file", file);
          return post("/api/import/file", fd, false);
        },
        after,
      ),
    [run, defaultAfter],
  );
  /** HTML captured in the reader's own browser (bookmarklet). */
  const importPage = useCallback(
    (page: { url: string; html: string; title?: string }, after: After = defaultAfter) => run("page", () => post("/api/import/page", JSON.stringify(page)), after),
    [run, defaultAfter],
  );

  return { busy, error, importUrl, importText, importFile, importPage };
}

export function looksLikeUrl(s: string) {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  // Any address with a scheme counts (an IP address, a port, a local name), and so does a bare domain.
  return /^https?:\/\/\S+$/i.test(t) || /^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t);
}

export function normaliseUrl(s: string) {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** True when a file can be imported (PDF, plain text or markdown). */
export function isImportableFile(f: File) {
  return /pdf|text\/plain|markdown/.test(f.type) || /\.(pdf|txt|md|markdown)$/i.test(f.name);
}

export { bookmarklet } from "./bookmarklet";
