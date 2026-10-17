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

export const GlossZ = z.object({
  id: IdZ,
  documentId: DocumentIdZ,
  action: z.enum(["ask", "explain", "simplify", "define", "factcheck", "related", "counterpoint", "overview", "whole"]),
  anchor: AnchorZ.nullable(),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), content: text(LIMITS.turn) })).max(LIMITS.turns),
  model: z.string().max(200).optional(),
  usage: z
    .object({ input: z.number().int().min(0).max(1e9), output: z.number().int().min(0).max(1e9), cost: z.number().min(0).max(1e6).optional() })
    .nullable()
    .optional(),
  createdAt: TimestampZ,
});

export const ProgressZ = z.object({
  documentId: DocumentIdZ,
  blockId: z.string().max(LIMITS.blockId).optional(),
  ratio: z.number().min(0).max(1),
  finished: z.boolean().optional(),
  updatedAt: TimestampZ,
});
