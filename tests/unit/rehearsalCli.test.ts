import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The command line of scripts/migration-rehearsal.mjs and the shell wrapper scripts/neon-rehearsal.sh, run as real processes. Every endpoint is
// fictional and under `.invalid`, which can never resolve, and the environment given to the processes holds nothing but PATH and HOME: nothing
// here can reach Neon, production or any other server.
const PROD = "ep-fake-prod-a1b2c3d4";
const STAGING = "ep-stage-copy-bbbb2222";
const DOMAIN = ".c-1.us-east-1.aws.fixture.invalid";
const PW = "SECRETPW99";
const host = (id: string, pooled = false) => `${id}${pooled ? "-pooler" : ""}${DOMAIN}`;
const url = (h: string, db = "neondb") => `postgresql://owner:${PW}@${h}/${db}?sslmode=require&channel_binding=require`;
const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const envOf = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv; // the project's ProcessEnv type insists on NODE_ENV

function node(args: string[], env: Record<string, string> = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["scripts/migration-rehearsal.mjs", ...args], { env: envOf({ ...base, ...env }), encoding: "utf8", timeout: 30_000, input: "" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t0 };
}
const goodArgs = (over: { branch?: string; endpoint?: string; prod?: string[]; confirm?: string } = {}) => [
  "--confirm-not-production",
  "--staging-branch", over.branch ?? "staging-0007",
  "--staging-endpoint", over.endpoint ?? STAGING,
  ...(over.prod ?? [host(PROD)]).flatMap((p) => ["--production-endpoint", p]),
  "--confirm", over.confirm ?? `staging-0007@${STAGING}`,
];
const stagingEnv = (h = host(STAGING), db = "neondb") => ({ REHEARSAL_DATABASE_URL: url(h, db) });

describe("migration-rehearsal.mjs refuses before it touches anything", () => {
  it("--guard-only accepts good inputs, says nothing was touched and never prints the string", () => {
    const r = node([...goodArgs(), "--guard-only"], stagingEnv());
    expect(r.status).toBe(0);
    expect(r.out).toContain("Guard passed");
    expect(r.out).toContain("No connection was made");
    expect(r.out).toContain("ep-***-2222");
    expect(r.out).not.toContain(PW);
    expect(r.out).not.toContain(STAGING);
  });
  it("refuses the removed --production-host flag", () => {
    const r = node(["--confirm-not-production", "--production-host", host(PROD), "--guard-only"], stagingEnv());
    expect(r.status).toBe(2);
    expect(r.out).toContain("no longer accepted");
  });
  it("refuses without --confirm-not-production", () => {
    const r = node(goodArgs().slice(1), stagingEnv());
    expect(r.status).toBe(2);
    expect(r.out).toContain("--confirm-not-production");
  });
  it.each([
    ["the production pooled string with production typed direct", host(PROD, true), { endpoint: PROD, confirm: `staging-0007@${PROD}`, prod: [host(PROD)] }, "E_IS_PRODUCTION"],
    ["the production direct string with production typed pooled", host(PROD), { endpoint: PROD, confirm: `staging-0007@${PROD}`, prod: [host(PROD, true)] }, "E_IS_PRODUCTION"],
    ["production typed with a port", host(PROD), { endpoint: PROD, confirm: `staging-0007@${PROD}`, prod: [`${host(PROD)}:5432`] }, "E_IS_PRODUCTION"],
    ["a look-alike endpoint", host("ep-fake-prod-b1b2c3d4"), { endpoint: "ep-fake-prod-b1b2c3d4", confirm: "staging-0007@ep-fake-prod-b1b2c3d4" }, "E_AMBIGUOUS"],
    ["a wrong branch", host(STAGING), { branch: "main", confirm: `main@${STAGING}` }, "E_BRANCH"],
    ["a branch and endpoint that do not match", host(STAGING), { endpoint: "ep-other-one-cccc3333" }, "E_ENDPOINT_MISMATCH"],
    ["no confirmation", host(STAGING), { confirm: "" }, "E_CONFIRMATION_MISSING"],
    ["no production endpoint", host(STAGING), { prod: [] }, "E_PRODUCTION_MISSING"],
  ])("exits 2 with %s", (_name, h, over, code) => {
    const dry = node([...goodArgs(over), "--guard-only"], stagingEnv(h));
    expect(dry.status).toBe(2);
    expect(dry.out).toContain(code);
    // A real run stops even earlier for a .invalid fixture (its domain is never accepted), but it must stop all the same.
    const real = node(goodArgs(over), stagingEnv(h));
    expect(real.status).toBe(2);
    for (const r of [dry, real]) {
      expect(r.out).toContain("Nothing was touched");
      expect(r.out).not.toContain(PW);
      expect(r.out).not.toContain("Waiting for the database"); // no connection was attempted
    }
  });
  it("a real run (not --guard-only) never accepts the .invalid test domain, and gets no further than the guard", () => {
    const r = node(goodArgs(), stagingEnv());
    expect(r.status).toBe(2);
    expect(r.out).toContain("E_HOST_SUFFIX");
    expect(r.out).not.toContain("Waiting for the database");
    expect(r.ms).toBeLessThan(10_000);
  });
  it("refuses without a connection string", () => {
    const r = node([...goodArgs(), "--guard-only"], {});
    expect(r.status).toBe(2);
    expect(r.out).toContain("E_MISSING");
  });
  it("a local rehearsal refuses the developer database and any non-local host", () => {
    for (const cs of ["postgresql://u:p@localhost:5433/gloss", "postgresql://u:p@localhost:5433/plataforma", `postgresql://u:${PW}@${host(STAGING)}/neondb`]) {
      const r = node(["--confirm-not-production", "--local", "--guard-only"], { REHEARSAL_DATABASE_URL: cs });
      expect(r.status).toBe(2);
      expect(r.out).not.toContain(PW);
    }
    const ok = node(["--confirm-not-production", "--local", "--guard-only"], { REHEARSAL_DATABASE_URL: "postgresql://u:p@localhost:5433/gloss_f8stg_1793596997" });
    expect(ok.status).toBe(0);
    expect(ok.out).toContain("local database gloss_f8stg_1793596997");
  });
});

describe("neon-rehearsal.sh fails closed", () => {
  function shell(args: string[], env: Record<string, string>) {
    const r = spawnSync("bash", ["scripts/neon-rehearsal.sh", ...args], { env: envOf({ ...base, ...env }), encoding: "utf8", timeout: 30_000, input: "" }); // closed stdin: a prompt gets end-of-file
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }
  const all = { ...stagingEnv(), STAGING_BRANCH: "staging-0007", STAGING_ENDPOINT: STAGING, PRODUCTION_ENDPOINT: host(PROD), CONFIRMATION: `staging-0007@${STAGING}` };
  it("--guard-only accepts the five values and stops (exit 0, nothing touched)", () => {
    const r = shell(["--guard-only"], all);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Guard passed");
    expect(r.out).not.toContain(PW);
  });
  it("accepts several production endpoints separated by commas", () => expect(shell(["--guard-only"], { ...all, PRODUCTION_ENDPOINT: `${host(PROD)}, ${host(PROD, true)} ,ep-prod-read-dddd4444` }).status).toBe(0));
  it("refuses a production endpoint list with an empty entry in the middle", () => expect(shell(["--guard-only"], { ...all, PRODUCTION_ENDPOINT: `${host(PROD)},,${host(PROD, true)}` }).status).toBe(2));
  it("refuses a production endpoint list with an entry that is not an endpoint", () => expect(shell(["--guard-only"], { ...all, PRODUCTION_ENDPOINT: `${host(PROD)},prod` }).status).toBe(2));
  it.each(["REHEARSAL_DATABASE_URL", "STAGING_BRANCH", "STAGING_ENDPOINT", "PRODUCTION_ENDPOINT", "CONFIRMATION"])("exits 2 when %s is missing (a prompt at end-of-file is a refusal)", (name) => {
    const env: Record<string, string> = { ...all };
    delete env[name];
    const r = shell(["--guard-only"], env);
    expect(r.status).toBe(2);
    expect(r.out).toContain("Nothing was touched");
  });
  it("refuses the removed PRODUCTION_HOST variable", () => {
    const env: Record<string, string> = { ...all, PRODUCTION_HOST: host(PROD) };
    delete env.PRODUCTION_ENDPOINT;
    const r = shell(["--guard-only"], env);
    expect(r.status).toBe(2);
    expect(r.out).toContain("PRODUCTION_HOST is no longer accepted");
  });
  it("refuses an unknown or extra argument", () => {
    expect(shell(["--run"], all).status).toBe(2);
    expect(shell(["--guard-only", "--x"], all).status).toBe(2);
  });
  it.each([
    ["production pooled string, production typed direct", { ...stagingEnv(host(PROD, true)), STAGING_ENDPOINT: PROD, CONFIRMATION: `staging-0007@${PROD}`, PRODUCTION_ENDPOINT: host(PROD) }],
    ["production direct string, production typed pooled", { ...stagingEnv(host(PROD)), STAGING_ENDPOINT: PROD, CONFIRMATION: `staging-0007@${PROD}`, PRODUCTION_ENDPOINT: host(PROD, true) }],
    ["production typed with a port", { ...stagingEnv(host(PROD)), STAGING_ENDPOINT: PROD, CONFIRMATION: `staging-0007@${PROD}`, PRODUCTION_ENDPOINT: `${host(PROD)}:5432` }],
    ["a wrong branch", { STAGING_BRANCH: "main", CONFIRMATION: `main@${STAGING}` }],
    ["a wrong confirmation", { CONFIRMATION: "yes" }],
  ])("exits 2 for %s", (_n, over) => {
    const r = shell(["--guard-only"], { ...all, ...over });
    expect(r.status).toBe(2);
    expect(r.out).toContain("Refused");
    expect(r.out).not.toContain(PW);
  });
});
