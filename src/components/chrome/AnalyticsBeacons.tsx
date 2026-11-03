"use client";

import { useEffect } from "react";
import { ageBucketOf, openedVia, track } from "@/lib/client/analytics";
import type { DocumentKind } from "@/lib/content/types";

/** Counts a visit to the landing page (once per page view). Renders nothing. */
export function LandingBeacon() {
  useEffect(() => {
    track("landing_viewed");
  }, []);
  return null;
}

const kindOf = (k: DocumentKind) => (k === "sample" || k === "url" || k === "pdf" || k === "text" || k === "link" ? k : "text");

/** Counts a text being opened: its kind, where the reader came from, and how long it had been saved (a bucket). Renders nothing. */
export function OpenedBeacon({ kind, savedAt, slug }: { kind: DocumentKind; savedAt?: string; slug: string }) {
  useEffect(() => {
    track("document_opened", { kind: kindOf(kind), via: openedVia(), age: kind === "sample" ? "0d" : ageBucketOf(savedAt) });
  }, [kind, savedAt, slug]);
  return null;
}
