import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** The provider's API address. Only the operator sets the override (an AI gateway or proxy, or a local stand-in under test); nothing a reader sends can change it. */
export const TOGETHER_BASE = process.env.GLOSS_TOGETHER_BASE_URL?.trim().replace(/\/$/, "") || "https://api.together.xyz/v1";
export const CHAT_MODEL = process.env.GLOSS_CHAT_MODEL || "openai/gpt-oss-120b";
export const EMBED_MODEL = process.env.GLOSS_EMBED_MODEL || "BAAI/bge-base-en-v1.5";
export const WHISPER_MODEL = process.env.GLOSS_WHISPER_MODEL || "openai/whisper-large-v3";

/** The user's own key (header) wins over the server key. Never logged, never stored. */
export function resolveKey(req: Request): { key: string | null; source: "user" | "server" | null } {
  const user = req.headers.get("x-gloss-key")?.trim();
  if (user) return { key: user, source: "user" };
  const server = process.env.TOGETHER_API_KEY?.trim();
  if (server) return { key: server, source: "server" };
  return { key: null, source: null };
}

export function provider(key: string) {
  return createOpenAICompatible({ name: "together", baseURL: TOGETHER_BASE, apiKey: key });
}

export function noKeyResponse() {
  return Response.json(
    {
      error: "needs-key",
      message: "Answers need a Together AI key. Add yours from the key button in the top bar.",
    },
    { status: 402 },
  );
}

/** Rough cost estimate for the footer, per million tokens (USD). Documented as an estimate. */
export function estimateCost(model: string, input: number, output: number) {
  // The operator can state the real prices (US dollars per million tokens, from the provider's billing page) instead of trusting the table.
  const envIn = Number(process.env.GLOSS_PRICE_IN_PER_M);
  const envOut = Number(process.env.GLOSS_PRICE_OUT_PER_M);
  if (process.env.GLOSS_PRICE_IN_PER_M && process.env.GLOSS_PRICE_OUT_PER_M && Number.isFinite(envIn) && Number.isFinite(envOut) && envIn >= 0 && envOut >= 0) return (input * envIn + output * envOut) / 1_000_000;
  const table: Record<string, [number, number]> = {
    "openai/gpt-oss-120b": [0.15, 0.6],
    "deepseek-ai/DeepSeek-V3.1": [0.6, 1.7],
    "deepseek-ai/DeepSeek-V3": [1.25, 1.25],
  };
  const [i, o] = table[model] ?? [0.6, 1.7];
  return (input * i + output * o) / 1_000_000;
}
