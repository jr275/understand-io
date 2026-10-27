import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, Reader, annotationFor, uid } from "./client";

/**
 * Signed-in users against a real server and PostgreSQL: the session is recognised, one account's library is invisible and untouchable to
 * another account, a forged or unknown session counts as nobody, and signing out clears both cookies. Google itself cannot be driven from a
 * test, so the two accounts are rows in the `accounts` table and their cookies are signed with the secret the server was started with.
 * Needs INTEGRATION_BASE_URL, DATABASE_URL (the server's disposable database) and GLOSS_COOKIE_SECRET (the server's secret).
 */
const DB = process.env.DATABASE_URL ?? "";
const SECRET = process.env.GLOSS_COOKIE_SECRET ?? "";
const READY = !!BASE && !!DB && SECRET.length >= 32;

const hmac = (s: string) => createHmac("sha256", SECRET).update(s).digest("base64url").slice(0, 22);
const readerCookie = (id: string) => `gloss_reader=${id}.${hmac(id)}`;
const sessionCookie = (id: string) => `gloss_session=${id}.${hmac(`session:${id}`)}`;
const run = randomBytes(4).toString("hex");

describe.skipIf(!READY)("signed-in users (real server, real database)", () => {
  const sql = postgres(DB, { max: 2, prepare: false });
  const accounts = [
    { id: `acc_${run}_a`, reader: `r_${run}_a`, email: `a-${run}@example.test`, name: "Account A" },
    { id: `acc_${run}_b`, reader: `r_${run}_b`, email: `b-${run}@example.test`, name: "Account B" },
  ];
  let a: Reader;
  let b: Reader;

  beforeAll(async () => {
    for (const x of accounts) {
      await sql`INSERT INTO readers (id) VALUES (${x.reader})`;
      await sql`INSERT INTO accounts (id, provider, subject, email, name, picture, reader_id) VALUES (${x.id}, 'google', ${`sub-${x.id}`}, ${x.email}, ${x.name}, NULL, ${x.reader})`;
    }
    a = new Reader("account-a");
    b = new Reader("account-b");
    a.cookie = `${readerCookie(accounts[0].reader)}; ${sessionCookie(accounts[0].id)}`;
    b.cookie = `${readerCookie(accounts[1].reader)}; ${sessionCookie(accounts[1].id)}`;
  });

  afterAll(async () => {
    // Deleting the readers removes their documents, marks, questions and positions with them (cascade); the accounts go with them.
    for (const x of accounts) await sql`DELETE FROM readers WHERE id = ${x.reader}`;
    await sql.end();
  });

  it("the server recognises a signed session and names its account, and no one else's", async () => {
    expect((await a.get("/api/auth/me")).json?.account).toMatchObject({ email: accounts[0].email, name: "Account A" });
    expect((await b.get("/api/auth/me")).json?.account).toMatchObject({ email: accounts[1].email });
  });

  it("a forged session, a session for an account that does not exist, and no session at all are nobody", async () => {
    const none = new Reader("anon");
    expect((await none.get("/api/auth/me")).json?.account).toBeNull();
    const forged = await none.call("GET", "/api/auth/me", undefined, { cookie: `gloss_session=${accounts[0].id}.AAAAAAAAAAAAAAAAAAAAAA` });
    expect(forged.json?.account).toBeNull();
    const unknown = await none.call("GET", "/api/auth/me", undefined, { cookie: sessionCookie(`acc_${run}_nobody`) });
    expect(unknown.json?.account).toBeNull();
    // A session signed for one purpose cannot be used as another: the reader signature is not a session.
    const swapped = await none.call("GET", "/api/auth/me", undefined, { cookie: `gloss_session=${accounts[0].reader}.${hmac(accounts[0].reader)}` });
    expect(swapped.json?.account).toBeNull();
  });

  it("each account's library is its own: not listed, not readable, not editable and not deletable by the other", async () => {
    const doc = await a.importText("Account A's private text.\n\nA second paragraph.", `Private ${uid("t")}`);
    const note = annotationFor(doc, { note: "account A secret note" });
    expect((await a.post("/api/annotations", note)).json?.applied).toBe(true);

    expect((await a.docs()).map((d) => d.id)).toContain(doc.id);
    expect((await b.docs()).map((d) => d.id)).not.toContain(doc.id);
    expect(JSON.stringify((await b.get(`/api/documents/${doc.id}/data`)).json)).not.toContain("account A secret note");

    await b.patch(`/api/documents/${doc.id}`, { title: "taken by B", favourite: true });
    await b.del(`/api/documents/${doc.id}`);
    const mine = (await a.docs()).find((d) => d.id === doc.id);
    expect(mine?.title).not.toBe("taken by B");
    expect([404, 409]).toContain((await b.post("/api/annotations", { ...note, note: "B overwrote it", updatedAt: Date.now() })).status);
    expect((await a.data(doc.id)).annotations.find((x) => x.id === note.id)?.note).toBe("account A secret note");
    expect((await b.post("/api/annotations", annotationFor(doc))).status).toBe(404); // nothing can be attached to A's document
  });

  it("holding one account's session with another account's reader cookie does not open the other library", async () => {
    // The library follows the reader cookie; a session cannot be used to reach a reader it does not own.
    const mixed = new Reader("mixed");
    mixed.cookie = `${readerCookie(accounts[1].reader)}; ${sessionCookie(accounts[0].id)}`;
    const docA = await a.importText("Only A may list this.\n\nSecond paragraph.", `Mixed ${uid("t")}`);
    expect((await mixed.docs()).map((d) => d.id)).not.toContain(docA.id);
  });

  it("signing out clears the session and the reader cookie", async () => {
    const res = await fetch(`${BASE}/api/auth/signout`, { method: "POST", headers: { cookie: a.cookie } });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie().map((c) => c.split(";")[0] + (/expires=Thu, 01 Jan 1970|max-age=0/i.test(c) ? " (cleared)" : ""));
    expect(cleared.some((c) => c.startsWith("gloss_session=") && c.includes("(cleared)"))).toBe(true);
    expect(cleared.some((c) => c.startsWith("gloss_reader=") && c.includes("(cleared)"))).toBe(true);
  });

  it("a signed-in user's library is still there after signing out and in again", async () => {
    const again = new Reader("account-a-again");
    again.cookie = `${readerCookie(accounts[0].reader)}; ${sessionCookie(accounts[0].id)}`;
    expect((await again.docs()).length).toBeGreaterThan(0);
  });
});
