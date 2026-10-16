"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { GlossDocument } from "@/lib/content/types";
import { getLocalDocument, useLibrary } from "@/lib/store/library";
import { Topbar } from "@/components/chrome/Topbar";
import { Reader } from "./Reader";

/** Server-provided document, or a local-only one from this browser, or a not-found state. */
export function ReaderLoader({ slug, initial }: { slug: string; initial: GlossDocument | null }) {
  const lib = useLibrary();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // lib.docs is read so a document imported in this tab appears without a reload.
  const localDoc = mounted ? (lib.docs[slug]?.blocks.length ? lib.docs[slug] : getLocalDocument(slug)) : null;
  const doc = useMemo<GlossDocument | null>(() => initial ?? localDoc, [initial, localDoc]);
  const checked = !!initial || mounted;

  if (doc) return <Reader doc={doc} key={doc.slug} />;
  return (
    <div className="relative z-[1] min-h-dvh">
      <Topbar variant="reader" />
      <main className="mx-auto max-w-[40rem] px-6 pt-[calc(var(--topbar-h)+96px)] text-center">
        {checked ? (
          <>
            <p className="font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.05] tracking-[-0.02em] text-ink">Not on your shelves.</p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">
              There is no text at <code className="rounded bg-sunk px-1.5 py-0.5 text-[13px]">/read/{slug}</code> in this browser or in your library on this server.
            </p>
            <Link href="/" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-bg">
              Paste a link
            </Link>
          </>
        ) : (
          <div className="loading-bar mx-auto w-40" aria-label="Loading" />
        )}
      </main>
    </div>
  );
}
