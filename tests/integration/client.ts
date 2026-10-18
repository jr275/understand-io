/**
 * A minimal HTTP client for the integration tests: one instance is one reader (its own cookie jar), talking to a real server
 * that is running against a disposable PostgreSQL. Nothing here imports application code, so a test can only do what a browser can.
 */
const rand = () => Math.floor(Math.random() * 254) + 1;

export const BASE = process.env.INTEGRATION_BASE_URL ?? "";

export interface Reply {
  status: number;
  headers: Headers;
  json: Record<string, unknown> | null;
}

export interface DocRow {
  id: string;
  title: string;
}
export interface MarkRow {
  id: string;
  note?: string;
}
export interface GlossRow {
  id: string;
  turns: { content: string }[];
}
export interface DocData {
  annotations: MarkRow[];
  glosses: GlossRow[];
  progress: { ratio: number } | null;
}

export class Reader {
  cookie = "";
  /** A private client address per reader (the server keys its limiter on it), so readers and repeated runs never share a budget. */
  readonly ip = `10.${rand()}.${rand()}.${rand()}`;
  constructor(readonly name: string) {}

  async call(method: string, path: string, body?: unknown, init: { cookie?: string | null } = {}): Promise<Reply> {
    const cookie = init.cookie === undefined ? this.cookie : init.cookie;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-forwarded-for": this.ip, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      if (pair.startsWith("gloss_reader=") && init.cookie === undefined) this.cookie = pair;
    }
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json };
  }

  get = (path: string) => this.call("GET", path);
  post = (path: string, body: unknown) => this.call("POST", path, body);
  put = (path: string, body: unknown) => this.call("PUT", path, body);
  patch = (path: string, body: unknown) => this.call("PATCH", path, body);
  del = (path: string) => this.call("DELETE", path);

  /** This reader's own document list. */
  async docs(): Promise<DocRow[]> {
    return ((await this.get("/api/documents")).json?.documents ?? []) as DocRow[];
  }

  /** The marks, questions and position this reader holds for a document. */
  async data(documentId: string): Promise<DocData> {
    const j = (await this.get(`/api/documents/${documentId}/data`)).json ?? {};
    return { annotations: (j.annotations ?? []) as MarkRow[], glosses: (j.glosses ?? []) as GlossRow[], progress: (j.progress ?? null) as DocData["progress"] };
  }

  /** Imports a text and returns the saved document (the first call also gives this reader its cookie). */
  async importText(text: string, title: string) {
    const r = await this.post("/api/import/text", { text, title });
    if (r.status !== 200 || !r.json?.persisted) throw new Error(`${this.name}: import failed ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.document as { id: string; slug: string; title: string; blocks: { id: string; text: string }[] };
  }
}

let counter = 0;
/** A valid, unique id for an annotation or gloss. */
export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** An annotation body anchored on the first words of the document's first block. */
export function annotationFor(doc: { id: string; blocks: { id: string; text: string }[] }, over: Record<string, unknown> = {}) {
  const b = doc.blocks[0];
  const quote = b.text.slice(0, 12);
  const now = Date.now() - 1000;
  return {
    id: uid("an"),
    documentId: doc.id,
    kind: "note",
    color: "yellow",
    note: "original note",
    anchor: { start: { b: b.id, o: 0 }, end: { b: b.id, o: quote.length }, quote },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
