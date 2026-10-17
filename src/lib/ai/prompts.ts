import type { Anchor, GlossAction } from "@/lib/content/types";

export interface ContextBlock {
  id: string;
  n?: number;
  text: string;
}

const LENGTH: Record<string, string> = {
  short: "Answer in one or two sentences.",
  normal: "Answer in about a paragraph (3–5 sentences).",
  long: "Answer in two or three short paragraphs.",
};

export function systemPrompt(length: string) {
  return [
    "You are Understand.io, a careful reading companion. The reader has selected a passage in a text and asks about it.",
    "Ground every claim in the text supplied. Cite the paragraphs you draw on with their number in the form ¶12 (use the ¶ sign and the number, nothing else).",
    "Start with the single most useful sentence and wrap that sentence in ==double equals== so it can be marked. Only one such sentence.",
    "Write plainly, in the reader's language (match the language of the question if there is one, otherwise the text). No headings. Use markdown only for *emphasis*, **bold**, `code` and short bullet lists.",
    "Mark exactly where you leave the text: begin a sentence with \"My reading:\" when it is your own interpretation, with \"Outside the text:\" when it relies on knowledge from beyond the paragraphs supplied, and with \"The text does not say:\" when the paragraphs cannot confirm something. Every sentence without such a label must be supported by the paragraphs and carry a ¶ citation.",
    "You only see the paragraphs supplied. Never claim to have read the rest of the text; if the question needs more than they show, say so.",
    "If the text does not support an answer, say so plainly instead of inventing one.",
    LENGTH[length] ?? LENGTH.normal,
  ].join(" ");
}

export function actionQuestion(action: GlossAction, question?: string) {
  switch (action) {
    case "explain":
      return "What does this mean here, and why is it here?";
    case "simplify":
      return "Say the same idea in plain words.";
    case "define":
      return "Define the selected word or phrase as this author uses it.";
    case "factcheck":
      return "Does this claim hold up? Weigh it against the rest of the text and common knowledge, and say what is uncertain.";
    case "related":
      return "Where else does the text take this up? Point to the paragraphs.";
    case "counterpoint":
      return "What is the strongest objection to this?";
    case "overview":
      return "Give the gist of the whole text, its key claims, and a short map of how it is organised, with paragraph citations.";
    case "whole":
    case "ask":
    default:
      return question?.trim() || "What does this mean here?";
  }
}

export function userPrompt(opts: { title: string; author?: string | null; anchor: Anchor | null; context: ContextBlock[]; question: string }) {
  const head = `Text: “${opts.title}”${opts.author ? ` by ${opts.author}` : ""}.`;
  const ctx = opts.context.map((b) => `¶${b.n ?? "—"} [${b.id}] ${b.text}`).join("\n\n");
  const sel = opts.anchor ? `\n\nSelected passage: “${opts.anchor.quote}”` : "";
  return `${head}\n\nRelevant paragraphs:\n\n${ctx}${sel}\n\nQuestion: ${opts.question}`;
}
