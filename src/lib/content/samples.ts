import type { GlossDocument } from "./types";
import chalk from "@/content/samples/on-a-piece-of-chalk.json";
import thinking from "@/content/samples/on-thinking-for-oneself.json";
import walden from "@/content/samples/walden-reading.json";

export const SAMPLES: GlossDocument[] = [chalk, thinking, walden].map((d) => ({
  ...(d as GlossDocument),
  id: `sample:${(d as GlossDocument).slug}`,
}));

export const SAMPLE_META = [
  { slug: "on-a-piece-of-chalk", short: "Huxley", tip: "On a Piece of Chalk", hint: "Thomas Henry Huxley, 1868" },
  { slug: "on-thinking-for-oneself", short: "Schopenhauer", tip: "On Thinking for Oneself", hint: "Arthur Schopenhauer, 1851" },
  { slug: "walden-reading", short: "Thoreau", tip: "Reading", hint: "Henry David Thoreau, 1854" },
];

export function getSample(slug: string) {
  return SAMPLES.find((s) => s.slug === slug) ?? null;
}
