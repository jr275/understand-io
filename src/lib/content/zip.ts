import { unzipSync } from "fflate";
import { ReadError } from "./errors";

/**
 * Ceilings for a zip-based upload (Word, EPUB). They are checked against the sizes the archive declares before anything is
 * inflated, so an archive that announces gigabytes is refused without allocating them. `fflate` inflates an entry into a buffer
 * of exactly its declared size, so an archive whose header lies about being small is cut off at that size instead of growing:
 * memory never exceeds the declared total.
 */
export const ZIP_LIMITS = { entries: 3000, entryBytes: 12 * 1024 * 1024, totalBytes: 40 * 1024 * 1024 };

/** `PK\x03\x04`, the signature every zip file starts with. */
export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * The entries `want` selects, inflated; every other entry is skipped without being inflated. Throws a `ReadError` (a message for
 * the reader) when the bytes are not a zip, hold too many entries, or a wanted entry or their sum is over the ceilings.
 */
export function readZip(bytes: Uint8Array, want: (name: string) => boolean, what: string, limits = ZIP_LIMITS): Map<string, Uint8Array> {
  if (!isZip(bytes)) throw new ReadError(`That file is not a valid ${what}.`);
  let entries = 0;
  let total = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        if (entries > limits.entries) throw new ReadError(`That ${what} holds too many parts to read here.`);
        if (!want(file.name)) return false;
        if (file.originalSize > limits.entryBytes) throw new ReadError(`A part of that ${what} is too large to read here.`);
        total += file.originalSize;
        if (total > limits.totalBytes) throw new ReadError(`That ${what} is too large to read here once unpacked.`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ReadError) throw err;
    throw new ReadError(`That file is not a valid ${what}, or it is damaged or protected.`);
  }
  return new Map(Object.entries(out));
}

/** UTF-8 text of an entry, without a byte-order mark. */
export function entryText(files: Map<string, Uint8Array>, name: string): string | null {
  const data = files.get(name);
  return data ? new TextDecoder("utf-8", { fatal: false }).decode(data).replace(/^﻿/, "") : null;
}
