/** Reads a request body while counting bytes, so an oversized upload is refused before it is parsed into memory. */
async function readCapped(req: Request, maxBytes: number): Promise<Blob | "too-large"> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  if (!req.body) return new Blob([]);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]);
}

/** Parsed multipart body, "too-large" when it exceeds `maxBytes`, or null when it is not a valid form. */
export async function readFormLimited(req: Request, maxBytes: number): Promise<FormData | "too-large" | null> {
  const body = await readCapped(req, maxBytes);
  if (body === "too-large") return body;
  return new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null);
}

/** Parsed JSON body, "too-large" when it exceeds `maxBytes`, or null when it is not valid JSON. */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown | "too-large" | null> {
  const body = await readCapped(req, maxBytes);
  if (body === "too-large") return body;
  return body.text().then((t) => JSON.parse(t) as unknown).catch(() => null);
}
