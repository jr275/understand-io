import { z } from "zod";
import type { AiItem, AiResult, Block, Coverage, SummaryVariant } from "@/lib/content/types";
import { checkItems, type ProposedItem } from "./evidence";
import { languageName } from "./languages";
import { UNTRUSTED_RULE, fenceDocument } from "./prompts";

/**
 * Structured AI operations. Each operation has its own prompt and its own output schema; the model answers with one JSON object, the
 * app validates it, and every quote the model offers as evidence is checked against the document before the reader sees it
 * (lib/ai/evidence.ts). What the model was given is recorded as coverage, so a summary never claims to cover more than it read.
 */

export type StructuredOp = "summarize" | "concepts" | "questions" | "translate";

export interface OpBlock {
  id: string;
  n?: number;
  type?: string;
  text: string;
}

export interface AiOpInput {
  op: StructuredOp;
  variant?: SummaryVariant;
  title: string;
  author?: string | null;
  /** Paragraphs to read. For document operations: the text from the chosen start; for a passage: the block(s) around it. */
  blocks: OpBlock[];
  /** Numbered paragraphs in the whole text (for the coverage statement). */
  totalParagraphs: number;
  /** The reader's selection (passage summary, translation). */
  selection?: string;
  targetLang?: string;
  /** Language of the output for summaries, concepts and questions; default: the text's own language. */
  outputLang?: string;
}

export type Generate = (a: { system: string; prompt: string; maxOutputTokens: number; signal?: AbortSignal }) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

export class AiOpError extends Error {
  constructor(
    message: string,
    readonly code: "bad-output" | "no-content" | "bad-input",
  ) {
    super(message);
  }
}

/** Text the model reads in one call, and the most calls one request may make: bounds cost on the server key. */
export const OP_LIMITS = { directChars: 28_000, chunkChars: 9_000, maxChunks: 8, maxBlocks: 700, maxChars: 110_000 } as const;

/* ------------------------------------------------------------------ prompts */

const RULES = [
  UNTRUSTED_RULE,
  "You work only from the numbered passages you are given. Reply with ONE JSON object and nothing else: no markdown fences, no commentary.",
  "Never invent quotes, page numbers, authors, dates, figures or facts. Do not describe parts of the text you were not given.",
  'Give every item a "basis": "text" when the passages themselves say it, "interpretation" when it is your own reading or synthesis, "external" only when it needs knowledge from outside the text (say so in the item; avoid it unless asked).',
  'For "text" items, "evidence" lists one to three quotes copied character for character from the passage with that id: {"id":"p12","quote":"exact words"}. Each quote is a contiguous stretch of 20 to 200 characters. Quote only the id of the passage the words are in.',
  "Keep reservations, uncertainty and opposing arguments the author gives. If the passages do not support something, leave it out or say so in caveats.",
];

const SHAPE = '{"items":[{"label":"optional short label","text":"…","basis":"text","evidence":[{"id":"p3","quote":"…"}]}],"caveats":["optional short notes on limits of the text"]}';

function langLine(outputLang?: string) {
  return outputLang ? `Write all text you produce (not the quotes) in ${languageName(outputLang)}.` : "Write in the language of the text.";
}

const VARIANT_TASK: Record<SummaryVariant, string> = {
  quick: "Write a quick summary: two to four short items, each one paragraph, giving the overview a reader needs to decide whether to read the whole text.",
  executive:
    'Write an executive summary with one item per label, using exactly these labels where the text supports them: "Thesis", "Main arguments", "Evidence", "Conclusions", "Practical implications". Leave a label out when the text gives nothing for it (say so in caveats).',
  detailed: "Write a detailed summary organised by section: one item per section in the order of the text, labelled with the section title from the outline. Cover its arguments and explanations, its key concepts, the examples the text itself uses, and its conclusions and reservations. Write at most 16 items in total and keep each one short.",
  ideas: "List the five to ten most important ideas of the text, one sentence each, most important first.",
  study:
    'Write study notes: one item per entry, using exactly these labels in this order where the text supports them: "Outline" (the structure of the argument, as short ordered points), "Concepts and definitions" (one item per essential term, defined as this text uses it), "Claims and evidence" (one item per important claim, with the evidence the author gives), "Relationships" (how concepts, causes and claims connect or conflict), "Key takeaways" (what a reader should remember), "Recall question" (one item per question that tests understanding of the text; write only the question), "Glossary" (one item per specialist term not defined above). Skip a label the text gives nothing for; never fill one from outside knowledge. Write at most 24 items in total: for a long text keep the most important terms, claims and takeaways, and keep every sentence short.',
  passage: "Summarise ONLY the selected passage, in one to three items. Do not bring in the rest of the text.",
};

/** Output room per variant. Study notes and detailed summaries of a long text are long answers: a cap that cuts the JSON in the middle loses all of it. */
export const VARIANT_TOKENS: Record<SummaryVariant, number> = { quick: 800, executive: 1200, detailed: 3200, ideas: 1000, study: 5000, passage: 600 };

function outline(blocks: OpBlock[]) {
  const heads = blocks.filter((b) => b.type === "h2" || b.type === "h3");
  return heads.length ? `Outline of the text you were given:\n${heads.map((h) => `- ${h.text}`).join("\n")}\n\n` : "";
}

export function formatBlocks(blocks: OpBlock[]) {
  return blocks.map((b) => `[${b.id}]${b.n ? ` ¶${b.n}` : ""}${b.type === "h2" || b.type === "h3" ? " (heading)" : ""} ${b.text}`).join("\n\n");
}

function head(i: AiOpInput) {
  return `Text: “${i.title}”${i.author ? ` by ${i.author}` : ""}.`;
}

function coverageLine(c: Coverage) {
  return c.complete ? `You were given the whole text (${c.total} paragraphs).` : `You were given paragraphs ${c.from} to ${c.to} of ${c.total}. Do not say anything about the rest.`;
}

/* ------------------------------------------------------------------ output schemas (model-facing, lenient) */

const ProposedEvidenceZ = z.object({ id: z.string().max(80), quote: z.string().max(2000) });
const ItemZ = z.object({
  label: z.string().max(200).optional(),
  text: z.string().min(1).max(4000),
  basis: z.enum(["text", "interpretation", "external"]).optional(),
  evidence: z.array(ProposedEvidenceZ).max(8).optional(),
  answer: z.string().max(4000).optional(),
});
const ItemsOutZ = z.object({ items: z.array(ItemZ).min(1).max(40), caveats: z.array(z.string().max(500)).max(10).optional() });
const TranslationOutZ = z.object({ sourceLang: z.string().max(40).optional(), natural: z.string().min(1).max(20_000), literal: z.string().max(20_000).optional(), notes: z.array(z.string().max(500)).max(12).optional() });

/** Pull the JSON object out of a model reply (it may arrive in a code fence or with a sentence around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object");
  return JSON.parse(body.slice(a, b + 1));
}

/**
 * The complete objects of the `items` array in a reply that was cut off before it ended (a long answer that reached the output limit).
 * Strings and nesting are followed, so a brace inside a quote does not end an item; the item that was being written when the reply
 * stopped is dropped. Null when there is no complete item.
 */
export function salvageItems(text: string): { items: unknown[] } | null {
  const key = text.search(/"items"\s*:\s*\[/);
  if (key < 0) return null;
  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = text.indexOf("[", key) + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* an item that is not valid JSON is skipped */
        }
        start = -1;
      }
      if (depth < 0) break;
    } else if (c === "]" && depth === 0) break;
  }
  return items.length ? { items } : null;
}

/**
 * One reply, parsed against `schema`; a reply that cannot be used is asked for once more. With `salvage`, a reply that was cut off keeps
 * its complete items instead of being thrown away (asking again would only produce the same long answer and be cut off again), and
 * `onSalvaged` says so, so the reader can be told.
 */
async function ask<T>(generate: Generate, schema: z.ZodType<T>, a: Parameters<Generate>[0], usage: { input: number; output: number }, salvage?: { onSalvaged: () => void }): Promise<T> {
  let prompt = a.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await generate({ ...a, prompt });
    usage.input += r.inputTokens;
    usage.output += r.outputTokens;
    try {
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return parsed.data;
    } catch {
      /* fall through to salvage and the retry */
    }
    if (salvage) {
      const cut = salvageItems(r.text);
      const kept = (cut?.items ?? []).filter((x) => ItemZ.safeParse(x).success).slice(0, 40);
      if (kept.length) {
        salvage.onSalvaged();
        return { items: kept } as unknown as T;
      }
    }
    prompt = `${a.prompt}\n\nYour previous reply was not a valid JSON object of the required shape. Reply again with only the JSON object.`;
  }
  throw new AiOpError("The model did not return a usable answer. Try again.", "bad-output");
}

/* ------------------------------------------------------------------ chunking and coverage */

/** Split blocks into reading chunks of at most `maxChars`, preferring to break before a heading once a chunk is half full. */
export function planChunks(blocks: OpBlock[], maxChars: number): OpBlock[][] {
  const chunks: OpBlock[][] = [];
  let cur: OpBlock[] = [];
  let size = 0;
  for (const b of blocks) {
    const heading = b.type === "h2" || b.type === "h3";
    if (cur.length && (size + b.text.length > maxChars || (heading && size > maxChars / 2))) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(b);
    size += b.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function coverageOf(read: OpBlock[], totalParagraphs: number, wholeInput: boolean): Coverage {
  const nums = read.map((b) => b.n).filter((n): n is number => typeof n === "number");
  const used = nums.length;
  const from = nums.length ? Math.min(...nums) : 0;
  const to = nums.length ? Math.max(...nums) : 0;
  const complete = wholeInput && used >= totalParagraphs;
  return {
    used,
    total: totalParagraphs,
    from,
    to,
    complete,
    note: complete
      ? undefined
      : used === 0
        ? "No numbered paragraphs were read."
        : used < to - from + 1
          ? `Read ${used} of ${totalParagraphs} paragraphs (between ${from} and ${to}, with gaps); the rest of the text was not read.`
          : `Read paragraphs ${from} to ${to} of ${totalParagraphs}; the rest of the text was not read.`,
  };
}

/* ------------------------------------------------------------------ operations */

const toBlock = (b: OpBlock): Block => ({ id: b.id, type: (b.type as Block["type"]) ?? "p", n: b.n, text: b.text });

export async function runAiOp(input: AiOpInput, generate: Generate, signal?: AbortSignal): Promise<{ result: AiResult; usage: { input: number; output: number } }> {
  const usage = { input: 0, output: 0 };
  if (input.op === "translate") return { result: await translate(input, generate, usage, signal), usage };
  if (!input.blocks.length) throw new AiOpError("There is no text to read.", "no-content");
  const variant = input.variant ?? "quick";
  if (input.op === "summarize" && variant === "passage" && !input.selection?.trim()) throw new AiOpError("Select a passage to summarise.", "bad-input");

  const isPassage = input.op === "summarize" && variant === "passage";
  const byId = new Map(input.blocks.map((b) => [b.id, toBlock(b)]));
  const totalChars = input.blocks.reduce((n, b) => n + b.text.length, 0);

  // Read in one call when it fits; otherwise section by section (bounded), then combine. Whatever was not read is reported.
  let read = input.blocks;
  let digest: string | null = null;
  let skippedSections = 0;
  let cutSections = 0;
  let cutFinal = false;
  const direct = isPassage || totalChars <= OP_LIMITS.directChars;
  if (!direct) {
    const chunks = planChunks(input.blocks, OP_LIMITS.chunkChars);
    const used = chunks.slice(0, OP_LIMITS.maxChunks);
    read = used.flat();
    const results = await Promise.all(
      used.map(async (chunk) => {
        const nums = chunk.map((b) => b.n).filter(Boolean) as number[];
        const where = nums.length ? `paragraphs ${Math.min(...nums)} to ${Math.max(...nums)}` : "this section";
        // One section the model cannot answer in usable form must not cost the reader the others: it is left out and the coverage says so.
        const out = await ask(
          generate,
          ItemsOutZ,
          {
            system: [...RULES, `This is one section (${where}) of a longer text. Write five to eight short notes on what it says: its claims, arguments, evidence, conclusions and reservations. Shape: ${SHAPE}`, "Write in the language of the text."].join(" "),
            prompt: `${head(input)}\n\n${fenceDocument(formatBlocks(chunk))}`,
            maxOutputTokens: 900,
            signal,
          },
          usage,
          { onSalvaged: () => { cutSections += 1; } },
        ).catch((err: unknown) => {
          if (err instanceof AiOpError && err.code === "bad-output") return null;
          throw err; // a timeout, a caller leaving or a provider failure ends the request as before
        });
        return out ? { chunk, where, items: out.items } : null;
      }),
    );
    const notes = results.filter((r): r is NonNullable<typeof r> => r !== null);
    if (!notes.length) throw new AiOpError("The model did not return a usable answer. Try again.", "bad-output");
    skippedSections = results.length - notes.length;
    read = notes.flatMap((n) => n.chunk);
    digest = notes
      .map((n) => `Notes on ${n.where}:\n${n.items.map((it) => `- ${it.text}${it.evidence?.length ? ` (evidence: ${it.evidence.map((e) => `[${e.id}] “${e.quote}”`).join("; ")})` : ""}`).join("\n")}`)
      .join("\n\n");
  }
  const wholeInput = !isPassage;
  const coverage = isPassage ? coverageOf(input.blocks, input.totalParagraphs, false) : coverageOf(read, input.totalParagraphs, wholeInput && read.length === input.blocks.length);
  if (isPassage) coverage.note = "Summary of the selected passage only.";

  const task = input.op === "summarize" ? VARIANT_TASK[variant] : input.op === "concepts" ? "List the key concepts and technical terms a reader needs for this text. One item per term: put the term in label and explain it as this text uses it." : "Write five comprehension questions that check whether the reader understood the text, mixing questions answered directly by the text with ones that need inference. Put the question in text and the answer, grounded in the text, in answer.";
  const maxOutputTokens = input.op === "summarize" ? VARIANT_TOKENS[variant] : 1300;
  const system = [...RULES, task, `Shape: ${SHAPE}`, langLine(input.outputLang), isPassage ? "" : coverageLine(coverage)].filter(Boolean).join(" ");
  const body = digest
    ? `${head(input)}\n\nThe text is long, so it was read section by section. Combine these notes into your answer; quote ids and quotes only from the notes' evidence.\n\n${fenceDocument(`${outline(read)}${digest}`)}`
    : isPassage
      ? `${head(input)}\n\nSelected passage: “${input.selection}”\n\nThe passage sits in these paragraphs:\n\n${fenceDocument(formatBlocks(input.blocks))}`
      : `${head(input)}\n\n${fenceDocument(`${variant === "detailed" || variant === "study" ? outline(read) : ""}${formatBlocks(read)}`)}`;

  const out = await ask(generate, ItemsOutZ, { system, prompt: body, maxOutputTokens, signal }, usage, { onSalvaged: () => { cutFinal = true; } });
  const allowed = new Set(read.map((b) => b.id));
  const items: AiItem[] = checkItems(out.items as ProposedItem[], byId, allowed);
  const caveats = out.caveats ?? [];
  if (cutFinal) caveats.push("The model's answer was cut off before it ended, so only the complete items are shown.");
  if (cutSections) caveats.push(`The notes on ${cutSections} section${cutSections === 1 ? " were" : "s were"} cut off, so parts of the text may be covered less fully.`);
  if (skippedSections) caveats.push(`${skippedSections} section${skippedSections === 1 ? "" : "s"} of the text could not be summarised and ${skippedSections === 1 ? "is" : "are"} not covered here.`);
  if (items.some((i) => i.unverified)) caveats.push("Some statements could not be tied to a quote from the text and are shown as interpretation.");
  if (input.op === "summarize") return { result: { kind: "summary", variant, items, caveats, coverage }, usage };
  if (input.op === "concepts") return { result: { kind: "concepts", items, caveats, coverage }, usage };
  return { result: { kind: "questions", items, caveats, coverage }, usage };
}

async function translate(input: AiOpInput, generate: Generate, usage: { input: number; output: number }, signal?: AbortSignal): Promise<AiResult> {
  const sel = input.selection?.trim();
  if (!sel) throw new AiOpError("Select the text to translate.", "bad-input");
  if (!input.targetLang) throw new AiOpError("Choose a target language.", "bad-input");
  const context = input.blocks.length ? `\n\nThe selection comes from this surrounding text (use it only to settle meaning; do not translate it):\n${fenceDocument(formatBlocks(input.blocks))}` : "";
  const out = await ask(
    generate,
    TranslationOutZ,
    {
      system: [
        `You are a careful translator. Translate only the SELECTED TEXT into ${languageName(input.targetLang)}. Reply with ONE JSON object and nothing else.`,
        UNTRUSTED_RULE,
        'Shape: {"sourceLang":"ISO 639-1 code of the original","natural":"a fluent, natural translation","literal":"a word-for-word rendering, only when it differs materially from the natural one (idioms, fixed expressions)","notes":["short notes on idioms, technical terms, ambiguities or untranslatable words"]}.',
        "Keep names, numbers and formatting, and keep the paragraph breaks (blank lines) of the selection. Add nothing that is not in the selection. If the selection is already in the target language, translate nothing: set natural to the selection and say so in notes.",
      ].join(" "),
      prompt: `${head(input)}\n\nSELECTED TEXT:\n${sel}${context}`,
      maxOutputTokens: Math.min(2400, 300 + Math.ceil(sel.length / 2)),
      signal,
    },
    usage,
  );
  return {
    kind: "translation",
    sourceLang: (out.sourceLang ?? "").toLowerCase().slice(0, 8),
    targetLang: input.targetLang,
    original: sel, // the app's own copy: the model never rewrites the original
    natural: out.natural,
    literal: out.literal && out.literal.trim() !== out.natural.trim() ? out.literal : undefined,
    notes: out.notes ?? [],
    contextUsed: input.blocks.length > 0,
  };
}
