import type { Block } from "./types";

/**
 * The text of a document as it is compared for identity: each block's text in Unicode NFC with runs of whitespace collapsed, blocks joined by a
 * newline. Case and punctuation are kept on purpose: two texts that differ only by capitals are different texts, and merging them would hide one.
 */
export function normalizedText(blocks: Pick<Block, "text">[]): string {
  return blocks
    .map((b) => b.text.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Fewest characters of normalised text for which an identical text counts as a duplicate. Below it, two items with the same few words (a note
 * that says "Hello.", a one-line list) are probably different things, and merging them would hide one. The Reader's own check uses the same figure.
 */
export const MIN_DEDUP_CHARS = 200;

export function longEnoughToCompare(blocks: Pick<Block, "text">[]): boolean {
  return normalizedText(blocks).length >= MIN_DEDUP_CHARS;
}

/** SHA-256 (hex) of the normalised text. Web Crypto exists in the browser and in Node, so the server and the Reader compute the same value. */
export async function contentHash(blocks: Pick<Block, "text">[]): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedText(blocks)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
