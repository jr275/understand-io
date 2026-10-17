import { z } from "zod";

/** Size bounds for what a caller may make the provider read on the server key (SEC-1). */
export const LIMITS = {
  quote: 6000,
  anchorContext: 400,
  blockId: 40,
  historyTurns: 12,
  historyChars: 24000,
  historyTurnChars: 6000,
  contextBlocks: 80,
  contextBlockChars: 6000,
  contextChars: 30000,
  searchChars: 40000,
  jsonBytes: 600_000,
  audioBytes: 5 * 1024 * 1024,
} as const;

const point = z.object({ b: z.string().max(LIMITS.blockId), o: z.number().int().min(0).max(1_000_000) });

export const anchorSchema = z.object({
  start: point,
  end: point,
  quote: z.string().max(LIMITS.quote),
  prefix: z.string().max(LIMITS.anchorContext).optional(),
  suffix: z.string().max(LIMITS.anchorContext).optional(),
});

export const GLOSS_ACTIONS = ["ask", "explain", "simplify", "define", "factcheck", "related", "counterpoint", "overview", "whole"] as const;

export const historySchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(LIMITS.historyTurnChars) })).max(40);

/**
 * Keeps the newest turns that fit the turn and character budget (a long thread loses its oldest turns
 * instead of failing), and makes sure the history starts with a user turn.
 */
export function limitHistory<T extends { role: string; content: string }>(history: T[] | undefined): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (let i = history?.length ?? 0; i-- > 0 && kept.length < LIMITS.historyTurns; ) {
    const t = history![i];
    if (chars + t.content.length > LIMITS.historyChars) break;
    chars += t.content.length;
    kept.unshift(t);
  }
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
}

/** Messages shown to the caller instead of provider text when the server key pays. */
export const SERVER_KEY_ERROR = "The shared AI service could not answer right now. Try again later, or add your own Together key with the key button in the top bar.";
