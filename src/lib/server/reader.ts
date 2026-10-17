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
  const id = `r_${randomBytes(9).toString("base64url")}`;
  jar.set(READER_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 2,
  });
  return id;
}
