"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMounted } from "@/lib/client/useMounted";
import type { GlossDocument } from "@/lib/content/types";
import { getLocalDocument, useLibrary } from "@/lib/store/library";
import { Topbar } from "@/components/chrome/Topbar";
import { Reader } from "./Reader";
import { LinkPage } from "./LinkPage";
import { OpenedBeacon } from "@/components/chrome/AnalyticsBeacons";
import { useT } from "@/i18n/client";

/** Server-provided document, or a local-only one from this browser, or a not-found state. */
export function ReaderLoader({ slug, initial, unavailable = false }: { slug: string; initial: GlossDocument | null; unavailable?: boolean }) {
  const t = useT();
  const lib = useLibrary();
  const mounted = useMounted();
  // lib.docs is read so a document imported in this tab appears without a reload.
  const localDoc = mounted ? (lib.docs[slug]?.blocks.length ? lib.docs[slug] : getLocalDocument(slug)) : null;
  const doc = useMemo<GlossDocument | null>(() => initial ?? localDoc, [initial, localDoc]);
  const checked = !!initial || mounted;

  if (doc?.kind === "link") return <LinkPage doc={doc} key={doc.slug} />;
  if (doc)
    return (
      <>
        <OpenedBeacon kind={doc.kind} savedAt={doc.createdAt} slug={doc.slug} />
        <Reader doc={doc} key={doc.slug} />
      </>
    );
  return (
    <div className="relative z-[1] min-h-dvh">
      <Topbar variant="reader" />
      <main className="mx-auto max-w-[40rem] px-6 pt-[calc(var(--topbar-h)+96px)] text-center">
        {checked && unavailable ? (
          <>
            <p className="font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.05] tracking-[-0.02em] text-ink">{t("loader.outOfReach")}</p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">
              {t("loader.outOfReachHelp")}
            </p>
            <button type="button" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-bg" onClick={() => window.location.reload()}>
              {t("loader.tryAgain")}
            </button>
          </>
        ) : checked ? (
          <>
            <p className="font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.05] tracking-[-0.02em] text-ink">{t("loader.notOnShelves")}</p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">
              {t("loader.noText", { path: `/read/${slug}` })}
            </p>
            <Link href="/" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-bg">
              {t("loader.pasteLink")}
            </Link>
          </>
        ) : (
          <div className="loading-bar mx-auto w-40" aria-label={t("loader.loading")} />
        )}
      </main>
    </div>
  );
}
