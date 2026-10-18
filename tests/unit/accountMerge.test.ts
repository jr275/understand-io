// SEC-4: a reader that already belongs to an account must never be merged away or adopted by another account.
// The integration block talks to the real local PostgreSQL (DATABASE_URL from .env.local) with uniquely named
// rows that it removes again; it is skipped when no database is configured.
import dotenv from "dotenv";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });

import { getDb } from "@/lib/db/client";
import { accounts, documents, readers } from "@/lib/db/schema";
import { mergeReaders, planSignIn, signInGoogle } from "@/lib/server/auth";

describe("planSignIn (pure decision)", () => {
  it("existing account merges an anonymous current reader into its own", () => {
    expect(planSignIn({ existingReaderId: "r_B", currentReaderId: "r_anon", currentReaderOwnerId: null })).toEqual({ mergeFrom: "r_anon", adopt: null });
  });
  it("existing account never merges a reader that belongs to a (different) account", () => {
    expect(planSignIn({ existingReaderId: "r_B", currentReaderId: "r_A", currentReaderOwnerId: "a_A" })).toEqual({ mergeFrom: null, adopt: null });
  });
  it("existing account with its own reader in the cookie has nothing to merge", () => {
    expect(planSignIn({ existingReaderId: "r_B", currentReaderId: "r_B", currentReaderOwnerId: "a_B" })).toEqual({ mergeFrom: null, adopt: null });
    expect(planSignIn({ existingReaderId: "r_B", currentReaderId: null, currentReaderOwnerId: null })).toEqual({ mergeFrom: null, adopt: null });
  });
  it("a new account adopts only an unowned reader, otherwise gets a fresh one", () => {
    expect(planSignIn({ existingReaderId: null, currentReaderId: "r_anon", currentReaderOwnerId: null })).toEqual({ mergeFrom: null, adopt: "r_anon" });
    expect(planSignIn({ existingReaderId: null, currentReaderId: "r_A", currentReaderOwnerId: "a_A" })).toEqual({ mergeFrom: null, adopt: null });
    expect(planSignIn({ existingReaderId: null, currentReaderId: null, currentReaderOwnerId: null })).toEqual({ mergeFrom: null, adopt: null });
  });
});

const tag = `sectest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const db = process.env.DATABASE_URL ? getDb() : null;

async function addDoc(readerId: string, n: string) {
  await db!.insert(readers).values({ id: readerId }).onConflictDoNothing();
  await db!.insert(documents).values({ id: `${tag}_d_${n}`, readerId, slug: `${tag}-${n}`, kind: "text", title: n, blocks: [] });
}

describe.skipIf(!db)("account merge safety (real PostgreSQL)", () => {
  afterAll(async () => {
    if (!db) return;
    // signInGoogle gives each new account a reader with a random id, so the readers to remove are found through what they own;
    // deleting a reader cascades to its account and its documents.
    const owned = new Set<string>();
    for (const r of await db.select({ id: accounts.readerId }).from(accounts).where(like(accounts.subject, `${tag}%`))) owned.add(r.id);
    for (const r of await db.select({ id: documents.readerId }).from(documents).where(like(documents.id, `${tag}%`))) owned.add(r.id);
    if (owned.size) await db.delete(readers).where(inArray(readers.id, [...owned]));
    await db.delete(accounts).where(like(accounts.subject, `${tag}%`));
    await db.delete(readers).where(like(readers.id, `${tag}%`));
    await db.$client.end({ timeout: 2 });
    globalThis.__glossDb = undefined;
  });

  it("two accounts, then B signs in on a browser carrying A's reader: A survives, B's library is untouched, nothing is shared", async () => {
    const a = await signInGoogle({ sub: `${tag}-A` }, null);
    const b = await signInGoogle({ sub: `${tag}-B` }, null);
    expect(a.readerId).not.toBe(b.readerId);
    await addDoc(a.readerId, "a1");
    await addDoc(b.readerId, "b1");

    const again = await signInGoogle({ sub: `${tag}-B` }, a.readerId); // B on A's browser
    expect(again.readerId).toBe(b.readerId);

    const rows = await db!.select().from(accounts).where(like(accounts.subject, `${tag}%`));
    expect(rows.map((r) => r.subject).sort()).toEqual([`${tag}-A`, `${tag}-B`]); // A's account row is not cascade-deleted
    expect((await db!.select().from(readers).where(eq(readers.id, a.readerId))).length).toBe(1);
    const aDocs = await db!.select({ id: documents.id }).from(documents).where(eq(documents.readerId, a.readerId));
    const bDocs = await db!.select({ id: documents.id }).from(documents).where(eq(documents.readerId, b.readerId));
    expect(aDocs.map((d) => d.id)).toEqual([`${tag}_d_a1`]); // A's library stayed A's
    expect(bDocs.map((d) => d.id)).toEqual([`${tag}_d_b1`]);
  });

  it("a brand-new identity on a browser carrying A's reader gets a fresh reader, never A's", async () => {
    const a = await signInGoogle({ sub: `${tag}-A2` }, null);
    await addDoc(a.readerId, "a2");
    const c = await signInGoogle({ sub: `${tag}-C` }, a.readerId);
    expect(c.readerId).not.toBe(a.readerId);
    const owners = await db!.select({ subject: accounts.subject }).from(accounts).where(eq(accounts.readerId, a.readerId));
    expect(owners.map((o) => o.subject)).toEqual([`${tag}-A2`]);
    expect((await db!.select({ id: documents.id }).from(documents).where(eq(documents.readerId, c.readerId))).length).toBe(0);
  });

  it("an anonymous library is still merged into an existing account and adopted by a new one", async () => {
    const b = await signInGoogle({ sub: `${tag}-B2` }, null);
    const anon1 = `${tag}_anon1`;
    await addDoc(anon1, "an1");
    await signInGoogle({ sub: `${tag}-B2` }, anon1);
    const moved = await db!.select({ id: documents.id }).from(documents).where(eq(documents.readerId, b.readerId));
    expect(moved.map((d) => d.id)).toContain(`${tag}_d_an1`);
    expect((await db!.select().from(readers).where(eq(readers.id, anon1))).length).toBe(0);

    const anon2 = `${tag}_anon2`;
    await addDoc(anon2, "an2");
    const d = await signInGoogle({ sub: `${tag}-D` }, anon2);
    expect(d.readerId).toBe(anon2);
  });

  it("mergeReaders refuses to drop a reader that belongs to an account", async () => {
    const a = await signInGoogle({ sub: `${tag}-A3` }, null);
    const b = await signInGoogle({ sub: `${tag}-B3` }, null);
    await addDoc(a.readerId, "a3");
    await mergeReaders(db!, a.readerId, b.readerId);
    expect((await db!.select().from(accounts).where(eq(accounts.subject, `${tag}-A3`))).length).toBe(1);
    expect((await db!.select({ id: documents.id }).from(documents).where(and(eq(documents.readerId, a.readerId), inArray(documents.id, [`${tag}_d_a3`])))).length).toBe(1);
  });

  it("the database refuses two accounts on one reader (unique accounts.reader_id)", async () => {
    const a = await signInGoogle({ sub: `${tag}-A4` }, null);
    await expect(db!.insert(accounts).values({ id: `${tag}_dup`, provider: "google", subject: `${tag}-A4dup`, readerId: a.readerId })).rejects.toThrow();
  });
});
