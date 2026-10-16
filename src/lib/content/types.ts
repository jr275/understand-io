export type BlockType = "p" | "h2" | "h3" | "quote" | "li" | "pre" | "note" | "figure" | "table";

export interface Run {
  text: string;
  em?: boolean;
  strong?: boolean;
  code?: boolean;
  href?: string;
}

export interface Block {
  /** Stable id within a document, e.g. "p12" or "notes". */
  id: string;
  type: BlockType;
  /** Paragraph number shown in the gutter; headings have none. */
  n?: number;
  /** Plain text of the block. Anchors index into this string. */
  text: string;
  runs?: Run[];
  /** figure only */
  src?: string;
  alt?: string;
}

export type DocumentKind = "url" | "pdf" | "text" | "sample";

export interface GlossDocument {
  id?: string;
  slug: string;
  kind: DocumentKind;
  title: string;
  author?: string | null;
  dek?: string | null;
  year?: number | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  topic: string;
  minutes: number;
  paragraphs: number;
  blocks: Block[];
  favourite?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** A position inside a block's plain text. */
export interface AnchorPoint {
  b: string;
  o: number;
}

/** Text anchor: block ids + offsets, plus the quote and short context for re-anchoring. */
export interface Anchor {
  start: AnchorPoint;
  end: AnchorPoint;
  quote: string;
  prefix?: string;
  suffix?: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";
export type AnnotationKind = "highlight" | "underline" | "note";

export interface Annotation {
  id: string;
  documentId: string;
  kind: AnnotationKind;
  color?: HighlightColor;
  note?: string;
  anchor: Anchor;
  createdAt: number;
  updatedAt: number;
}

export type GlossAction =
  | "ask"
  | "explain"
  | "simplify"
  | "define"
  | "factcheck"
  | "related"
  | "counterpoint"
  | "overview"
  | "whole";

export interface GlossTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Gloss {
  id: string;
  documentId: string;
  action: GlossAction;
  anchor: Anchor | null;
  turns: GlossTurn[];
  model?: string;
  usage?: { input: number; output: number; cost?: number } | null;
  createdAt: number;
  status?: "streaming" | "done" | "error";
  error?: string;
}

export interface ReadingProgress {
  documentId: string;
  blockId?: string;
  ratio: number;
  finished?: boolean;
  updatedAt: number;
}

export const TOPICS: { id: string; label: string; color: string; deep: string }[] = [
  { id: "ai", label: "AI", color: "#5b4a9e", deep: "#3f336f" },
  { id: "programming", label: "Programming", color: "#2f4f8f", deep: "#213764" },
  { id: "infra", label: "Infrastructure", color: "#3f5f6f", deep: "#2b424d" },
  { id: "data", label: "Data", color: "#2f6f8f", deep: "#214d64" },
  { id: "security", label: "Security", color: "#6f3f3f", deep: "#4d2b2b" },
  { id: "tech", label: "Tech & internet", color: "#4a6f8f", deep: "#334d64" },
  { id: "design", label: "Design", color: "#c0603a", deep: "#8f4224" },
  { id: "product", label: "Product", color: "#8a5a9e", deep: "#613f6f" },
  { id: "startups", label: "Startups", color: "#b06030", deep: "#7c4321" },
  { id: "business", label: "Business", color: "#7a5230", deep: "#563820" },
  { id: "work", label: "Work & careers", color: "#5f6f3f", deep: "#424d2b" },
  { id: "economics", label: "Economics", color: "#6f6f3f", deep: "#4d4d2b" },
  { id: "money", label: "Money", color: "#4f7f4f", deep: "#375837" },
  { id: "science", label: "Science", color: "#3a6b45", deep: "#274a30" },
  { id: "health", label: "Health", color: "#8f3f5f", deep: "#642b42" },
  { id: "mind", label: "Mind", color: "#6f4f8f", deep: "#4d3764" },
  { id: "climate", label: "Climate & energy", color: "#3f7f6f", deep: "#2b584d" },
  { id: "philosophy", label: "Philosophy", color: "#5e4b7a", deep: "#3f3154" },
  { id: "history", label: "History", color: "#8f6f3f", deep: "#644d2b" },
  { id: "politics", label: "Politics & society", color: "#8f3f3f", deep: "#642b2b" },
  { id: "culture", label: "Culture", color: "#9e5a7a", deep: "#6f3f55" },
  { id: "writing", label: "Writing", color: "#4f4f7f", deep: "#373758" },
  { id: "learning", label: "Learning", color: "#2c7a76", deep: "#1c5654" },
  { id: "living", label: "Living", color: "#7f7f4f", deep: "#585837" },
  { id: "unsorted", label: "Unsorted", color: "#6b665e", deep: "#4a463f" },
];

export function topicInfo(id: string) {
  return TOPICS.find((t) => t.id === id) ?? TOPICS[TOPICS.length - 1];
}
