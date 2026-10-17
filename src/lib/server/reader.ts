import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const READER_COOKIE = "gloss_reader";

function secret() {
  const s = process.env.GLOSS_COOKIE_SECRET;
  if (s && s !== "change-me") return s;
  if (process.env.NODE_ENV === "production") throw new Error("GLOSS_COOKIE_SECRET must be set in production.");
  return "gloss-dev-secret";
}

function sign(id: string) {
  return createHmac("sha256", secret()).update(id).digest("base64url").slice(0, 22);
}

/** `value.signature` for other cookies (session, OAuth state); `kind` keeps the signatures apart. */
export function signToken(kind: string, value: string) {
  return `${value}.${sign(`${kind}:${value}`)}`;
}

export function verifyToken(kind: string, raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(`${kind}:${value}`);
  if (expected.length !== sig.length) return null;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? value : null;
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 2,
};

/** The cookie value for a reader id: `id.signature`. The format is fixed; changing it would log every existing reader out. */
export function readerCookieValue(id: string) {
  return `${id}.${sign(id)}`;
}

/** Point this browser at a specific reader id (used when an account signs in). */
export async function setReaderCookie(id: string) {
  const jar = await cookies();
  jar.set(READER_COOKIE, readerCookieValue(id), COOKIE_OPTS);
}

export function newReaderId() {
  return `r_${randomBytes(9).toString("base64url")}`;
}

export function verifyReaderCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (expected.length !== sig.length) return null;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? id : null;
}

/** Reader id from the cookie, or null (server components cannot set cookies). */
export async function getReaderId(): Promise<string | null> {
  const jar = await cookies();
  return verifyReaderCookie(jar.get(READER_COOKIE)?.value);
}

/** Reader id, creating and setting the cookie when missing (route handlers / server actions only). */
export async function ensureReaderId(): Promise<string> {
  const jar = await cookies();
  const existing = verifyReaderCookie(jar.get(READER_COOKIE)?.value);
  if (existing) return existing;
  const id = newReaderId();
  jar.set(READER_COOKIE, readerCookieValue(id), COOKIE_OPTS);
  return id;
}
