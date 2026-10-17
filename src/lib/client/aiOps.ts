"use client";

import type { AiResult, Block, GlossDocument, SummaryVariant } from "@/lib/content/types";
import { getUserKey } from "@/lib/store/library";

export interface AiOpRequest {
  op: "summarize" | "concepts" | "questions" | "translate";
  variant?: SummaryVariant;
  title: string;
  author?: string | null;
  blocks: { id: string; n?: number; type?: string; text: string }[];
  totalParagraphs: number;
  selection?: string;
  targetLang?: string;
  outputLang?: string;
}

export interface AiOpResponse {
  result?: AiResult;
  model?: string;
  usage?: { input: number; output: number; cost?: number };
  error?: string;
  /** The server wants a key (no shared key and none supplied). */
  needsKey?: boolean;
}

const MAX_BLOCKS = 700;
const MAX_CHARS = 110_000;

/** The paragraphs a document operation reads: from `startIndex`, in order, within what one request may carry. Headings are included (they give the outline). */
export function documentBlocks(doc: Pick<GlossDocument, "blocks">, startIndex = 0) {
  const total = doc.blocks.filter((b) => b.n).length;
  const out: AiOpRequest["blocks"] = [];
  let chars = 0;
  for (let i = startIndex; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.type === "figure" || !b.text.trim()) continue;
    const text = b.text.length > 6000 ? b.text.slice(0, 6000) : b.text;
    if (out.length >= MAX_BLOCKS || chars + text.length > MAX_CHARS) break;
    out.push({ id: b.id, n: b.n, type: b.type, text });
    chars += text.length;
  }
  return { blocks: out, totalParagraphs: total };
}

/** The blocks that contain a selection (and one neighbour either side for context), as the request carries them. */
export function blocksAround(blocks: Block[], ids: string[], neighbours = 1): AiOpRequest["blocks"] {
  if (!ids.length) return [];
  const i0 = blocks.findIndex((b) => b.id === ids[0]);
  const i1 = blocks.findIndex((b) => b.id === ids[ids.length - 1]);
  if (i0 < 0 || i1 < 0) return [];
  return blocks
    .slice(Math.max(0, i0 - neighbours), Math.min(blocks.length, i1 + neighbours + 1))
    .filter((b) => b.type !== "figure" && b.text.trim())
    .map((b) => ({ id: b.id, n: b.n, type: b.type, text: b.text.slice(0, 6000) }));
}

export async function callAiOp(req: AiOpRequest, signal?: AbortSignal): Promise<AiOpResponse> {
  const key = getUserKey();
  let res: Response;
  try {
    res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-gloss-key": key } : {}) }, body: JSON.stringify(req), signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return {};
    return { error: "Could not reach the server. Check your connection and try again." };
  }
  const j = (await res.json().catch(() => ({}))) as { result?: AiResult; model?: string; usage?: AiOpResponse["usage"]; error?: string; message?: string };
  if (!res.ok) return { error: j.message || `Request failed (${res.status}).`, needsKey: j.error === "needs-key" };
  if (!j.result) return { error: "The server sent no result." };
  return { result: j.result, model: j.model, usage: j.usage };
}
