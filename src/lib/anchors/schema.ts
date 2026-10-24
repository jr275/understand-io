import { z } from "zod";
import { NOTE_MAX_LENGTH } from "@/lib/content/types";

/** Limits for everything a client may store about an annotation, gloss or reading position (ANNOT-9, SEC-14). */
export const LIMITS = {
  quote: 20_000,
  context: 64,
  blockId: 64,
  offset: 10_000_000,
  note: NOTE_MAX_LENGTH,
  turn: 20_000,
  turns: 40,
  /** Client clocks may run a little ahead; anything further than a day is rejected. */
  futureMs: 24 * 60 * 60 * 1000,
} as const;

/** True for strings without lone UTF-16 surrogates (they cannot be stored in JSON/jsonb and break serialisation). */
export function isWellFormed(s: string): boolean {
  const native = (s as string & { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof native === "function") return native.call(s);
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

const text = (max: number) => z.string().max(max).refine(isWellFormed, "lone surrogate");

export const IdZ = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/, "bad id");
/** `sample:<slug>`, a server document id, or a slug. */
export const DocumentIdZ = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, "bad document id");
/** Integer milliseconds since the epoch, not before 1970 and not more than a day ahead of the server clock. */
export const TimestampZ = z
  .number()
  .int()
  .min(0)
  .refine((n) => n <= Date.now() + LIMITS.futureMs, "timestamp in the future");

const PointZ = z.object({ b: z.string().min(1).max(LIMITS.blockId), o: z.number().int().min(0).max(LIMITS.offset) });

export const AnchorZ = z
  .object({
    start: PointZ,
    end: PointZ,
    quote: text(LIMITS.quote).refine((q) => q.trim().length > 0, "empty quote"),
    prefix: text(LIMITS.context).optional(),
    suffix: text(LIMITS.context).optional(),
    prevBlock: text(LIMITS.context).optional(),
    nextBlock: text(LIMITS.context).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.start.b !== a.end.b) return;
    if (a.start.o > a.end.o) ctx.addIssue({ code: "custom", message: "start after end", path: ["end", "o"] });
    else if (a.end.o - a.start.o !== a.quote.length) ctx.addIssue({ code: "custom", message: "offsets do not match the quote", path: ["end", "o"] });
  });

export const ColorZ = z.enum(["yellow", "green", "blue", "pink"]);
export const KindZ = z.enum(["highlight", "underline", "note"]);

export const AnnotationZ = z.object({
  id: IdZ,
  documentId: DocumentIdZ,
  kind: KindZ,
  color: ColorZ.optional(),
  note: text(LIMITS.note).optional(),
  anchor: AnchorZ,
  createdAt: TimestampZ,
  updatedAt: TimestampZ,
});

export const AnnotationPatchZ = z.object({ color: ColorZ.optional(), note: text(LIMITS.note).optional(), kind: KindZ.optional(), updatedAt: TimestampZ.optional() });

/* Structured AI results (lib/ai): bounded so a client cannot store arbitrary documents in the result column. */
const EvidenceZ = z.object({ blockId: z.string().min(1).max(LIMITS.blockId), n: z.number().int().min(0).max(1_000_000).optional(), quote: text(1000), start: z.number().int().min(0).max(LIMITS.offset), end: z.number().int().min(0).max(LIMITS.offset) });
const AiItemZ = z.object({
  label: text(300).optional(),
  text: text(6000),
  basis: z.enum(["text", "interpretation", "external"]),
  evidence: z.array(EvidenceZ).max(8),
  unverified: z.boolean().optional(),
  answer: text(6000).optional(),
});
const CoverageZ = z.object({ used: z.number().int().min(0).max(1_000_000), total: z.number().int().min(0).max(1_000_000), from: z.number().int().min(0).max(1_000_000), to: z.number().int().min(0).max(1_000_000), complete: z.boolean(), note: text(500).optional() });
/** Which text and language a result was written for (see `ResultBasis`): a SHA-256 hex digest and a language code, both optional. */
const resultBasis = { docHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), outLang: z.string().max(8).optional() };
const itemsResult = { items: z.array(AiItemZ).max(60), caveats: z.array(text(600)).max(12), coverage: CoverageZ, ...resultBasis };
export const GlossResultZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), variant: z.enum(["quick", "executive", "detailed", "ideas", "study", "passage"]), ...itemsResult }),
  z.object({ kind: z.literal("concepts"), ...itemsResult }),
  z.object({ kind: z.literal("questions"), ...itemsResult }),
  z.object({
    kind: z.literal("translation"),
    sourceLang: z.string().max(8),
    targetLang: z.string().max(8),
    original: text(LIMITS.quote),
    natural: text(20_000),
    literal: text(20_000).optional(),
    notes: z.array(text(600)).max(12),
    contextUsed: z.boolean(),
    range: z.object({ from: z.number().int().min(0).max(1_000_000), to: z.number().int().min(0).max(1_000_000) }).optional(),
    ...resultBasis,
  }),
  z.object({ kind: z.literal("stream"), context: z.array(z.string().max(LIMITS.blockId)).max(400), coverage: CoverageZ }),
]);

export const GlossZ = z.object({
  id: IdZ,
  documentId: DocumentIdZ,
  action: z.enum(["ask", "explain", "simplify", "define", "factcheck", "related", "counterpoint", "overview", "whole", "summarize", "translate", "concepts", "questions"]),
  anchor: AnchorZ.nullable(),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), content: text(LIMITS.turn) })).max(LIMITS.turns),
  model: z.string().max(200).optional(),
  usage: z
    .object({ input: z.number().int().min(0).max(1e9), output: z.number().int().min(0).max(1e9), cost: z.number().min(0).max(1e6).optional() })
    .nullable()
    .optional(),
  result: GlossResultZ.nullable().optional(),
  createdAt: TimestampZ,
});

export const ProgressZ = z.object({
  documentId: DocumentIdZ,
  blockId: z.string().max(LIMITS.blockId).optional(),
  ratio: z.number().min(0).max(1),
  finished: z.boolean().optional(),
  updatedAt: TimestampZ,
});
