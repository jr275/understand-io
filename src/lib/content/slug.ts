import { customAlphabet } from "nanoid";

const short = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);
export const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

/** `title-words-xxxxx`, matching the reference's slug shape. */
export function slugFor(title: string) {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${base || "text"}-${short()}`;
}

export function readingMinutes(blocks: { text: string }[]) {
  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / 220));
}
