import { TOGETHER_BASE, WHISPER_MODEL, resolveKey } from "@/lib/ai/provider";
import { LIMITS, SERVER_KEY_ERROR } from "@/lib/ai/requestLimits";
import { readFormLimited } from "@/lib/server/body";
import { limitServerKey } from "@/lib/server/rateLimit";

export const maxDuration = 60;

/** What MediaRecorder produces in the browsers we support (webm/opus, mp4/aac, ogg), plus common upload formats. */
const AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/flac", "audio/x-flac", "audio/aac", "video/webm", "video/mp4"]);

/** Server transcription fallback (for browsers without SpeechRecognition). Needs a provider key. */
export async function POST(req: Request) {
  const { key, source } = resolveKey(req);
  if (!key) return Response.json({ error: "needs-key", message: "Server transcription needs a Together AI key." }, { status: 402 });
  if (source === "server") {
    const limited = await limitServerKey(req, "transcribe");
    if (limited) return limited;
  }
  // The multipart envelope adds a little to the file itself.
  const form = await readFormLimited(req, LIMITS.audioBytes + 64 * 1024);
  if (form === "too-large") return Response.json({ error: "too-large", message: "That recording is too long. Keep it under a few seconds." }, { status: 413 });
  const file = form?.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "bad-request", message: "No audio received." }, { status: 400 });
  if (file.size > LIMITS.audioBytes) return Response.json({ error: "too-large", message: "That recording is too long. Keep it under a few seconds." }, { status: 413 });
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!AUDIO_TYPES.has(type)) return Response.json({ error: "unsupported-media", message: "That does not look like an audio recording." }, { status: 415 });
  const lang = typeof form?.get("language") === "string" ? String(form?.get("language")) : undefined;
  const out = new FormData();
  out.append("file", file, "speech.webm");
  out.append("model", WHISPER_MODEL);
  if (lang) out.append("language", lang.slice(0, 2));
  let res: Response;
  try {
    res = await fetch(`${TOGETHER_BASE}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: out, signal: AbortSignal.any([req.signal, AbortSignal.timeout(30000)]) });
  } catch {
    return Response.json({ error: "provider", message: source === "server" ? SERVER_KEY_ERROR : "Transcription timed out or could not reach the provider." }, { status: 502 });
  }
  if (!res.ok) {
    const t = source === "server" ? "" : await res.text().catch(() => "");
    return Response.json({ error: "provider", message: source === "server" ? SERVER_KEY_ERROR : `Transcription failed (${res.status}). ${t.slice(0, 200)}` }, { status: 502 });
  }
  const j = (await res.json().catch(() => ({}))) as { text?: string };
  return Response.json({ text: (j.text ?? "").trim(), model: WHISPER_MODEL });
}
