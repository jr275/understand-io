"use client";

import type { Anchor, GlossAction, GlossTurn } from "@/lib/content/types";
import { getUserKey } from "@/lib/store/library";

const SENTINEL = "\u001e";

export interface GlossRequest {
  title: string;
  author?: string | null;
  action: GlossAction;
  question?: string;
  anchor: Anchor | null;
  context: { id: string; n?: number; text: string }[];
  length: string;
  history?: GlossTurn[];
}

export interface GlossMeta {
  model?: string;
  usage?: { input: number; output: number; cost?: number };
  error?: string;
}

/** Streams an answer; resolves with the trailer (model + usage) or an error message. */
export async function streamGloss(req: GlossRequest, onText: (full: string) => void, signal?: AbortSignal): Promise<GlossMeta> {
  const key = getUserKey();
  const res = await fetch("/api/gloss", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-gloss-key": key } : {}) },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return { error: j.message || j.error || `Request failed (${res.status}).` };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const i = buf.indexOf(SENTINEL);
    if (i >= 0) {
      text += buf.slice(0, i);
      onText(text);
      const trailer = buf.slice(i + 1);
      // The trailer may arrive in pieces; keep reading until done.
      let rest = trailer;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        rest += dec.decode(r.value, { stream: true });
      }
      try {
        return JSON.parse(rest) as GlossMeta;
      } catch {
        return {};
      }
    }
    text = buf;
    onText(text);
  }
  onText(text);
  return {};
}

export function hasAnyKey(serverKey: boolean) {
  return serverKey || !!getUserKey();
}
