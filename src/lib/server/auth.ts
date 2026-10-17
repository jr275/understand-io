import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, type Db } from "@/lib/db/client";
import { accounts, annotations, documents, glosses, readers, readingProgress, settings } from "@/lib/db/schema";
import { newReaderId, setReaderCookie, signToken, verifyToken } from "./reader";

export const SESSION_COOKIE = "gloss_session";
export const OAUTH_COOKIE = "gloss_oauth";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** Sign-in is available only when Google OAuth credentials and a database are configured. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !getDb()) return null;
  return { clientId, clientSecret };
}

/** Public origin for OAuth redirects: APP_URL when set, else the request's own origin. */
export function appOrigin(req: Request) {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}

export function redirectUri(req: Request) {
  return `${appOrigin(req)}/api/auth/google/callback`;
}

/* ------------------------------------------------------------------ OAuth state (PKCE) */

export interface OAuthState {
  state: string;
  verifier: string;
  next: string;
}

export function newOAuthState(next: string): OAuthState {
  return { state: randomBytes(16).toString("base64url"), verifier: randomBytes(32).toString("base64url"), next: next.startsWith("/") ? next : "/library" };
}

export function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function writeOAuthCookie(s: OAuthState) {
  const jar = await cookies();
  jar.set(OAUTH_COOKIE, signToken("oauth", Buffer.from(JSON.stringify(s)).toString("base64url")), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: 600,
  });
}

export async function readOAuthCookie(): Promise<OAuthState | null> {
  const jar = await cookies();
  const v = verifyToken("oauth", jar.get(OAUTH_COOKIE)?.value);
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  if (!v) return null;
  try {
    const s = JSON.parse(Buffer.from(v, "base64url").toString()) as OAuthState;
    return s && typeof s.state === "string" && typeof s.verifier === "string" ? s : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ Google */

export interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export async function exchangeGoogleCode(cfg: GoogleConfig, code: string, verifier: string, redirect: string): Promise<GoogleProfile> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) throw new Error(`Google did not accept the sign-in (${tokenRes.status}).`);
  const tok = (await tokenRes.json()) as { access_token?: string };
  if (!tok.access_token) throw new Error("Google returned no access token.");
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!infoRes.ok) throw new Error(`Could not read the Google profile (${infoRes.status}).`);
  const p = (await infoRes.json()) as GoogleProfile;
  if (!p.sub) throw new Error("Google returned no subject id.");
  return p;
}

/* ------------------------------------------------------------------ accounts & sessions */

export interface Account {
  id: string;
  readerId: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Find or create the account for a Google profile. A new account adopts this browser's anonymous
 * reader (nothing to merge). An existing account absorbs this browser's anonymous library, so what
 * was read before signing in follows the account.
 */
export async function signInGoogle(profile: GoogleProfile, currentReaderId: string | null): Promise<Account> {
  const db = getDb();
  if (!db) throw new Error("Sign-in needs a database.");
  const existing = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, "google"), eq(accounts.subject, profile.sub)))
    .limit(1);
  const patch = { email: profile.email ?? null, name: profile.name ?? null, picture: profile.picture ?? null, lastSeenAt: new Date() };
  if (existing[0]) {
    const acc = existing[0];
    if (currentReaderId && currentReaderId !== acc.readerId) await mergeReaders(db, currentReaderId, acc.readerId);
    await db.update(accounts).set(patch).where(eq(accounts.id, acc.id));
    return { id: acc.id, readerId: acc.readerId, ...patch };
  }
  const readerId = currentReaderId ?? newReaderId();
  await db.insert(readers).values({ id: readerId }).onConflictDoNothing();
  const id = `a_${randomBytes(9).toString("base64url")}`;
  await db.insert(accounts).values({ id, provider: "google", subject: profile.sub, readerId, ...patch });
  return { id, readerId, ...patch };
}

/** Move everything owned by reader `from` to reader `to`, then drop `from`. */
export async function mergeReaders(db: Db, from: string, to: string) {
  if (from === to) return;
  await db.transaction(async (tx) => {
    const [fromRow] = await tx.select({ id: readers.id }).from(readers).where(eq(readers.id, from)).limit(1);
    if (!fromRow) return; // anonymous reader never touched the server
    await tx.insert(readers).values({ id: to }).onConflictDoNothing();
    await tx.update(documents).set({ readerId: to }).where(eq(documents.readerId, from));
    await tx.update(annotations).set({ readerId: to }).where(eq(annotations.readerId, from));
    await tx.update(glosses).set({ readerId: to }).where(eq(glosses.readerId, from));
    // Progress is keyed by (document, reader): where both have a row, the account's wins.
    await tx.execute(sql`delete from reading_progress p where p.reader_id = ${from} and exists (select 1 from reading_progress q where q.reader_id = ${to} and q.document_id = p.document_id)`);
    await tx.update(readingProgress).set({ readerId: to }).where(eq(readingProgress.readerId, from));
    await tx.execute(sql`delete from settings where reader_id = ${from} and exists (select 1 from settings where reader_id = ${to})`);
    await tx.update(settings).set({ readerId: to }).where(eq(settings.readerId, from));
    await tx.delete(readers).where(eq(readers.id, from));
  });
}

export async function writeSession(acc: Account) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken("session", acc.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  await setReaderCookie(acc.readerId);
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete("gloss_reader");
}

/** The signed-in account for this request, or null. */
export async function currentAccount(): Promise<Account | null> {
  const db = getDb();
  if (!db) return null;
  const jar = await cookies();
  const id = verifyToken("session", jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row) return null;
  return { id: row.id, readerId: row.readerId, email: row.email, name: row.name, picture: row.picture };
}
