"use client";

import { useSyncExternalStore } from "react";
import { ImportQueue, QUEUE_LIMITS, type BatchSummary, type QueueItem } from "@/lib/store/importQueue";
import { rememberDocument, syncRemoteLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { FORMATS_LABEL, isImportableFile, sendFile } from "./import";
import { tNow } from "@/i18n/runtime";

function localizedSummary(s: BatchSummary): string {
  const parts = [tNow("srv.batchDone", { done: s.done, total: s.total })];
  if (s.duplicate) parts.push(tNow("srv.batchDup", { n: s.duplicate }));
  if (s.failed) parts.push(tNow("srv.batchFailed", { n: s.failed }));
  if (s.cancelled) parts.push(tNow("srv.batchCancelled", { n: s.cancelled }));
  return parts.join(", ") + ".";
}

/** The batch every file picker and drop feeds. One per page: a file dropped anywhere joins the same line. */
export const importQueue = new ImportQueue(
  (file, signal) => sendFile(file, signal),
  {
    onResult: (_item, r) => rememberDocument(r.document, r.persisted),
    onBatchDone: (s) => {
      toast(localizedSummary(s), { ttl: 9000 });
      void syncRemoteLibrary();
    },
  },
  QUEUE_LIMITS.concurrent,
  (file) => (isImportableFile(file) ? null : tNow("srv.onlyFormats", { formats: FORMATS_LABEL })),
);

const NONE: QueueItem[] = [];

export function useImportQueue(): QueueItem[] {
  return useSyncExternalStore(importQueue.subscribe, () => importQueue.items, () => NONE);
}

/**
 * Where a file picker or a drop hands its files. One file keeps the plain flow (it opens in the Reader); several go through the queue,
 * which reports each one on its own. Returns true when the queue took them.
 */
export function handleFiles(list: FileList | File[], single: (file: File) => void): boolean {
  const files = Array.from(list);
  if (!files.length) return false;
  if (files.length === 1) {
    single(files[0]);
    return false;
  }
  const r = importQueue.add(files);
  if (r.skipped) toast(tNow("srv.batchLimit", { files: QUEUE_LIMITS.files, skipped: r.skipped }), { ttl: 8000 });
  return true;
}
