"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Link2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { GlossDocument } from "@/lib/content/types";
import { removeDocument, rememberDocument } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { Topbar } from "@/components/chrome/Topbar";
import { Toasts } from "@/components/chrome/Toasts";

/**
 * The page of a saved link whose own page could not be read. It keeps the address, what the page says about itself and the reason,
 * and offers the honest ways forward: open the original, try reading it again, or bring the text in yourself.
 */
export function LinkPage({ doc }: { doc: GlossDocument }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const reason = doc.blocks.find((b) => b.id === "reason")?.text ?? "That page could not be read here.";
  const url = doc.sourceUrl ?? "";

  const tryAgain = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const j = (await res.json().catch(() => ({}))) as { document?: GlossDocument; persisted?: boolean; error?: string };
      if (!res.ok || !j.document) {
        toast(j.error || `Still could not read it (${res.status}).`, { ttl: 8000 });
        return;
      }
      // Read this time: the readable text replaces the link card.
      rememberDocument(j.document, j.persisted ?? false);
      removeDocument(doc.slug);
      toast(`Read “${j.document.title}”.`, { ttl: 4000 });
      router.replace(`/read/${j.document.slug}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-[1] min-h-dvh" data-link-page>
      <Topbar variant="reader" />
      <main className="mx-auto max-w-[40rem] px-6 pb-24 pt-[calc(var(--topbar-h)+64px)]">
        <p className="flex items-center gap-2 text-[13.5px] text-ink-3">
          <Link2 size={15} aria-hidden="true" /> Saved link{doc.sourceLabel ? ` · ${doc.sourceLabel}` : ""}
        </p>
        <h1 className="mt-4 font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.05] tracking-[-0.02em] text-ink">{doc.title}</h1>
        {doc.dek ? <p className="mt-4 text-[17px] leading-[1.5] text-ink-2">{doc.dek}</p> : null}
        <p className="mt-4 break-all text-[13.5px] text-ink-3">{url}</p>

        <div className="mt-8 rounded-[14px] border border-rule bg-bg px-5 py-4">
          <p className="text-[14px] font-medium text-ink">Why it is not a text yet</p>
          <p role="note" className="mt-1 text-[14px] leading-relaxed text-ink-2">
            {reason}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-bg">
            Open the original <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <button type="button" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full border border-rule px-4 text-[14px] font-medium text-ink-2 hover:border-rule-strong hover:text-ink disabled:opacity-50" onClick={() => void tryAgain()}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />} Try reading it again
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink-3 hover:bg-sunk hover:text-ink"
            onClick={() => {
              // Wait for the server to be told, or the library page loads while it still lists this card.
              void removeDocument(doc.slug).then(() => router.push("/library"));
            }}
          >
            <Trash2 size={15} aria-hidden="true" /> Remove
          </button>
        </div>

        <section aria-label="Ways to read it here" className="mt-10">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">To read it here</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-ink-2">
            <li>Open the page in your browser, select its text, and paste it with ⌘V (Ctrl+V) on any page of Understand.io.</li>
            <li>Or use the “Read in Understand” bookmarklet from the Add panel: it hands the page you are looking at to this app, including pages that need your login.</li>
            <li>If the page is a PDF behind a login, save the PDF and drop the file on any page here.</li>
          </ul>
        </section>
      </main>
      <Toasts />
    </div>
  );
}
