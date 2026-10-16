import { TOGETHER_BASE, WHISPER_MODEL, resolveKey } from "@/lib/ai/provider";

export const maxDuration = 60;

/** Server transcription fallback (for browsers without SpeechRecognition). Needs a provider key. */
export async function POST(req: Request) {
  const { key } = resolveKey(req);
  if (!key) return Response.json({ error: "needs-key", message: "Server transcription needs a Together AI key." }, { status: 402 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) return Response.json({ error: "bad-request", message: "No audio received." }, { status: 400 });
  const lang = typeof form?.get("language") === "string" ? String(form?.get("language")) : undefined;
  const out = new FormData();
  out.append("file", file, "speech.webm");
  out.append("model", WHISPER_MODEL);
  if (lang) out.append("language", lang.slice(0, 2));
  const res = await fetch(`${TOGETHER_BASE}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: out });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return Response.json({ error: "provider", message: `Transcription failed (${res.status}). ${t.slice(0, 200)}` }, { status: 502 });
  }
  const j = (await res.json()) as { text?: string };
  return Response.json({ text: (j.text ?? "").trim(), model: WHISPER_MODEL });
}
