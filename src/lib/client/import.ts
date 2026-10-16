"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { GlossDocument } from "@/lib/content/types";
import { rememberDocument } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";

export interface ImportResult {
  document: GlossDocument;
  persisted: boolean;
}

async function post(path: string, body: BodyInit, json = true): Promise<ImportResult> {
  const res = await fetch(path, { method: "POST", body, headers: json ? { "content-type": "application/json" } : undefined });
  const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || `Import failed (${res.status}).`);
  return data as ImportResult;
}

/** Imports a URL, pasted text or a file, remembers the document locally and opens the reader. */
export function useImport() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "url" | "text" | "file">(null);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    (r: ImportResult) => {
      rememberDocument(r.document, r.persisted);
      router.push(`/read/${r.document.slug}`);
    },
    [router],
  );

  const run = useCallback(
    async (kind: "url" | "text" | "file", task: () => Promise<ImportResult>) => {
      setBusy(kind);
      setError(null);
      try {
        finish(await task());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Import failed.";
        setError(msg);
        toast(msg);
      } finally {
        setBusy(null);
      }
    },
    [finish],
  );

  const importUrl = useCallback((url: string) => run("url", () => post("/api/import", JSON.stringify({ url }))), [run]);
  const importText = useCallback((text: string, title?: string) => run("text", () => post("/api/import/text", JSON.stringify({ text, title }))), [run]);
  const importFile = useCallback(
    (file: File) =>
      run("file", () => {
        const fd = new FormData();
        fd.append("file", file);
        return post("/api/import/file", fd, false);
      }),
    [run],
  );

  return { busy, error, importUrl, importText, importFile };
}

export function looksLikeUrl(s: string) {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t);
}

export function normaliseUrl(s: string) {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
