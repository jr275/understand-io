/**
 * Bytes → text the way a browser reads a page: a byte-order mark wins, then the charset the server declared, then (for a web page) the
 * one the page declares about itself, and only then a guess. The guess is UTF-8 when the bytes are valid UTF-8 and windows-1252
 * otherwise, which is what a page or file written before UTF-8 became the norm almost always is. Reading every page as UTF-8 turned
 * the accents of such pages into replacement characters.
 */

/**
 * windows-1252, which the web uses for "ISO-8859-1", "latin1" and "ascii" too. Node's TextDecoder reads bytes 0x80-0x9F of these as
 * control characters (plain Latin-1), but on the web they are the curly quotes, dashes, euro sign and bullets that pages of this kind
 * are full of, so the family is decoded here with the real table.
 */
const CP1252_C1 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

export function decodeWindows1252(bytes: Uint8Array): string {
  const units = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    units[i] = b >= 0x80 && b <= 0x9f ? CP1252_C1.charCodeAt(b - 0x80) : b;
  }
  return new TextDecoder("utf-16le").decode(units);
}

const decoderFor = (label: string): TextDecoder | null => {
  try {
    return new TextDecoder(label.trim().toLowerCase());
  } catch {
    return null; // a name this runtime does not know
  }
};

/** The charset in a `Content-Type` header, if any. */
export const declaredCharset = (contentType: string | null | undefined) => /charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i.exec(contentType ?? "")?.[1] ?? null;

/** The charset a page names in a `<meta>` tag within its first 4 KB (`<meta charset=…>` or the `http-equiv` form). */
export function metaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  return /<meta[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]+)/i.exec(head)?.[1] ?? null;
}

function bomLabel(b: Uint8Array): string | null {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return "utf-8";
  if (b[0] === 0xff && b[1] === 0xfe) return "utf-16le";
  if (b[0] === 0xfe && b[1] === 0xff) return "utf-16be";
  return null;
}

export function decodeBytes(bytes: Uint8Array, opts: { contentType?: string | null; html?: boolean } = {}): string {
  const labelled = bomLabel(bytes) ?? declaredCharset(opts.contentType) ?? (opts.html ? metaCharset(bytes) : null);
  const named = labelled ? decoderFor(labelled) : null;
  if (named) return named.encoding === "windows-1252" ? decodeWindows1252(bytes) : named.decode(bytes); // non-fatal: bytes that do not fit what they claim become replacement characters, as in a browser
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}
