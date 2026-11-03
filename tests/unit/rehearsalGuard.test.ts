import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { DRY_RUN_SUFFIXES, GuardError, assertDriverMatches, checkLocalTarget, checkRehearsalTarget, cleanChildEnv, endpointIdOf, maskEndpoint } from "../../scripts/lib/rehearsal-guard.mjs";

// Every endpoint here is fictional and under `.invalid`, a name that can never resolve: nothing in this file can reach Neon or any server.
const PROD = "ep-prod-main-aaaa1111";
const STAGING = "ep-stage-copy-bbbb2222";
const DOMAIN = ".c-1.us-east-1.aws.fixture.invalid";
const PW = "SECRETPW99";
const host = (id: string, pooled = false) => `${id}${pooled ? "-pooler" : ""}${DOMAIN}`;
const url = (h: string, o: { port?: string; db?: string; params?: string; pass?: string } = {}) =>
  `postgresql://owner:${o.pass ?? PW}@${h}${o.port ? `:${o.port}` : ""}/${o.db ?? "neondb"}${o.params === undefined ? "?sslmode=require&channel_binding=require" : o.params}`;

type Input = Parameters<typeof checkRehearsalTarget>[0];
const good = (over: Partial<Input> = {}): Input => ({
  connectionString: url(host(STAGING)),
  branch: "staging-0007",
  endpoint: STAGING,
  productionEndpoints: [host(PROD)],
  confirmation: `staging-0007@${STAGING}`,
  ...over,
});
const run = (over: Partial<Input> = {}, suffixes: readonly string[] = DRY_RUN_SUFFIXES) => checkRehearsalTarget(good(over), { suffixes });
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    const err = e as GuardError;
    expect(err.message).not.toContain(PW); // never the password, the user or the host of the string that was given
    expect(err.message).not.toContain("owner:");
    expect(err.message).not.toContain("fixture.invalid");
    return err.code;
  }
  return "ALLOWED";
}
/** The target IS production: the connection string, the stated endpoint and the confirmation all name it. */
const asProd = (h: string, productionTyped: string[]): Partial<Input> => ({ connectionString: url(h), endpoint: PROD, confirmation: `staging-0007@${PROD}`, productionEndpoints: productionTyped });

describe("production can never be the target (the endpoint id is the identity, not the host string)", () => {
  const cases: [string, Partial<Input>][] = [
    ["the production host, exactly as typed", asProd(host(PROD), [host(PROD)])],
    ["the production POOLED string, production typed as the DIRECT host", asProd(host(PROD, true), [host(PROD)])],
    ["the production DIRECT string, production typed as the POOLED host", asProd(host(PROD), [host(PROD, true)])],
    ["production typed with an explicit port", asProd(host(PROD), [`${host(PROD)}:5432`])],
    ["the staging string carries an explicit port 5432", { ...asProd(host(PROD), [host(PROD)]), connectionString: url(host(PROD), { port: "5432" }) }],
    ["production typed in upper case with a trailing dot", asProd(host(PROD), [`${host(PROD).toUpperCase()}.`])],
    ["production typed as a full connection URL", asProd(host(PROD), [url(host(PROD, true), { port: "5432" })])],
    ["production typed as the bare endpoint id", asProd(host(PROD), [PROD])],
    ["production typed as the bare endpoint id with a port", asProd(host(PROD), [`${PROD}:5432`])],
    ["production typed as the bare endpoint id with a trailing dot", asProd(host(PROD), [`${PROD}.`])],
    ["production typed with surrounding spaces", asProd(host(PROD), [`  ${host(PROD)}  `])],
    ["one of several production endpoints matches", asProd(host(PROD), [host("ep-other-one-cccc3333"), host(PROD, true)])],
    ["parameters on the production string", { ...asProd(host(PROD), [host(PROD)]), connectionString: url(host(PROD), { params: "?sslmode=verify-full" }) }],
  ];
  for (const [name, over] of cases) it(`blocks: ${name}`, () => expect(codeOf(() => run(over))).toBe("E_IS_PRODUCTION"));
});

describe("a staging endpoint that looks like production is ambiguous and refused", () => {
  const lookalike = (id: string): Partial<Input> => ({ connectionString: url(host(id)), endpoint: id, confirmation: `staging-0007@${id}` });
  it("blocks one character away", () => expect(codeOf(() => run(lookalike("ep-prod-main-aaaa1112")))).toBe("E_AMBIGUOUS"));
  it("blocks the same 8-character suffix with other words", () => expect(codeOf(() => run(lookalike("ep-other-words-aaaa1111")))).toBe("E_AMBIGUOUS"));
  it("blocks the same two words with another suffix", () => expect(codeOf(() => run(lookalike("ep-prod-main-zzzz9999")))).toBe("E_AMBIGUOUS"));
  it("blocks within three edits", () => expect(codeOf(() => run(lookalike("ep-prod-mail-aaab1111")))).toBe("E_AMBIGUOUS"));
  it("allows an unrelated endpoint", () => expect(codeOf(() => run())).toBe("ALLOWED"));
});

describe("the staging connection string must be one strict shape", () => {
  const bad: [string, string, string][] = [
    ["an extra port", url(host(STAGING), { port: "6543" }), "E_PORT"],
    ["a zero-padded port", url(host(STAGING), { port: "05432" }), "E_PORT"],
    ["a host parameter", url(host(STAGING), { params: `?host=${host(PROD)}` }), "E_URL_PARAMS"],
    ["a hostaddr parameter", url(host(STAGING), { params: "?hostaddr=10.0.0.1" }), "E_URL_PARAMS"],
    ["an options parameter naming an endpoint", url(host(STAGING), { params: `?options=endpoint%3D${PROD}` }), "E_URL_PARAMS"],
    ["a dbname parameter", url(host(STAGING), { params: "?dbname=other" }), "E_URL_PARAMS"],
    ["a port parameter", url(host(STAGING), { params: "?port=5433" }), "E_URL_PARAMS"],
    ["a repeated parameter", url(host(STAGING), { params: "?sslmode=require&sslmode=require" }), "E_URL_PARAMS"],
    ["sslmode=disable", url(host(STAGING), { params: "?sslmode=disable" }), "E_URL_PARAMS"],
    ["a parameter without a value", url(host(STAGING), { params: "?sslmode" }), "E_URL_PARAMS"],
    ["an unencoded @ in the password", `postgresql://owner:pa@ss@${host(STAGING)}/neondb`, "E_URL"],
    ["a second host after a comma", `postgresql://owner:${PW}@${host(STAGING)},${host(PROD)}/neondb`, "E_URL"],
    ["a trailing newline", `${url(host(STAGING))}\n`, "E_URL"],
    ["a space", `${url(host(STAGING))} `, "E_URL"],
    ["a backslash", `postgresql://owner:${PW}@${host(STAGING)}\\@${host(PROD)}/neondb`, "E_URL"],
    ["a fragment", `${url(host(STAGING))}#${host(PROD)}`, "E_URL"],
    ["a non-postgres scheme", `mysql://owner:${PW}@${host(STAGING)}/neondb`, "E_URL"],
    ["no password", `postgresql://owner@${host(STAGING)}/neondb`, "E_URL"],
    ["no database", `postgresql://owner:${PW}@${host(STAGING)}`, "E_URL"],
    ["an upper-case host", url(host(STAGING).toUpperCase()), "E_URL"],
    ["a look-alike letter in the host (Cyrillic е)", url(host(STAGING).replace("e", "е")), "E_URL"],
    ["an empty string", "", "E_MISSING"],
  ];
  for (const [name, cs, code] of bad) it(`blocks: ${name}`, () => expect(codeOf(() => run({ connectionString: cs }))).toBe(code));
  it("allows an explicit port 5432", () => expect(run({ connectionString: url(host(STAGING), { port: "5432" }) }).port).toBe(5432));
  it("allows the parameters Neon gives", () => expect(codeOf(() => run({ connectionString: url(host(STAGING), { params: "?sslmode=require&channel_binding=require&connect_timeout=15" }) }))).toBe("ALLOWED"));
  it("allows no parameters", () => expect(codeOf(() => run({ connectionString: url(host(STAGING), { params: "" }) }))).toBe("ALLOWED"));
});

describe("an unknown or wrong kind of endpoint is refused", () => {
  const bad: [string, string, string][] = [
    ["localhost", url("localhost"), "E_HOST"],
    ["a numeric host", url("10.0.0.1"), "E_HOST"],
    ["a host that is not an endpoint", url("db.example.invalid"), "E_HOST"],
    ["an id with the wrong shape", url(`ep-onlyone${DOMAIN}`), "E_HOST"],
    ["an id with a short suffix", url(`ep-stage-copy-bb22${DOMAIN}`), "E_HOST"],
    ["no domain", url(STAGING), "E_HOST"],
  ];
  for (const [name, cs, code] of bad) it(`blocks: ${name}`, () => expect(codeOf(() => run({ connectionString: cs }))).toBe(code));
  it("blocks a host outside the Neon domain (default domains)", () => expect(codeOf(() => checkRehearsalTarget(good({ connectionString: url(`${STAGING}.example.com`) })))).toBe("E_HOST_SUFFIX"));
  it("blocks every fixture when the dry-run domain is not enabled (real runs never accept .invalid)", () => expect(codeOf(() => checkRehearsalTarget(good()))).toBe("E_HOST_SUFFIX"));
  it("blocks a domain that only ends like Neon's", () => expect(codeOf(() => checkRehearsalTarget(good({ connectionString: url(`${STAGING}.fake-neon.tech`) })))).toBe("E_HOST_SUFFIX"));
  it("blocks a domain that continues past Neon's", () => expect(codeOf(() => checkRehearsalTarget(good({ connectionString: url(`${STAGING}.neon.tech.attacker.example`) })))).toBe("E_HOST_SUFFIX"));
  it("accepts a real-looking Neon domain for a different endpoint", () => expect(checkRehearsalTarget(good({ connectionString: url(`${STAGING}.c-9.us-east-2.aws.neon.tech`) })).endpointId).toBe(STAGING));
});

describe("branch, endpoint and confirmation must agree (and exist)", () => {
  it.each([
    ["main", "E_BRANCH"],
    ["production", "E_BRANCH"],
    ["staging", "E_BRANCH"],
    ["Staging-0007", "E_BRANCH"],
    ["staging-main", "E_BRANCH"],
    ["staging-production", "E_BRANCH"],
    ["staging-", "E_BRANCH"],
    ["staging-" + "x".repeat(60), "E_BRANCH"],
    ["staging 0007", "E_BRANCH"],
    ["", "E_BRANCH_MISSING"],
  ])("blocks the branch name %j", (branch, code) => expect(codeOf(() => run({ branch, confirmation: `${branch}@${STAGING}` }))).toBe(code));
  it("blocks a stated endpoint that is not the one in the string", () => expect(codeOf(() => run({ endpoint: "ep-other-one-cccc3333" }))).toBe("E_ENDPOINT_MISMATCH"));
  it("blocks a stated endpoint that is not an endpoint", () => expect(codeOf(() => run({ endpoint: "staging-0007" }))).toBe("E_ENDPOINT_FORMAT"));
  it("blocks a missing stated endpoint", () => expect(codeOf(() => run({ endpoint: "" }))).toBe("E_ENDPOINT_MISSING"));
  it("blocks a confirmation naming another endpoint", () => expect(codeOf(() => run({ confirmation: "staging-0007@ep-other-one-cccc3333" }))).toBe("E_CONFIRMATION"));
  it("blocks a confirmation naming another branch", () => expect(codeOf(() => run({ confirmation: `staging-0008@${STAGING}` }))).toBe("E_CONFIRMATION"));
  it("blocks a confirmation that is only the endpoint", () => expect(codeOf(() => run({ confirmation: STAGING }))).toBe("E_CONFIRMATION"));
  it("blocks a confirmation that is only the branch", () => expect(codeOf(() => run({ confirmation: "staging-0007" }))).toBe("E_CONFIRMATION"));
  it("blocks a missing confirmation", () => expect(codeOf(() => run({ confirmation: "" }))).toBe("E_CONFIRMATION_MISSING"));
  it("blocks a blank confirmation", () => expect(codeOf(() => run({ confirmation: "   " }))).toBe("E_CONFIRMATION_MISSING"));
  it("blocks an absent confirmation", () => expect(codeOf(() => run({ confirmation: undefined }))).toBe("E_CONFIRMATION_MISSING"));
  it("accepts the confirmation with surrounding whitespace removed", () => expect(codeOf(() => run({ confirmation: ` staging-0007@${STAGING}\n` }))).toBe("ALLOWED"));
});

describe("production must be stated and readable (no fallback)", () => {
  it("blocks no production endpoint", () => expect(codeOf(() => run({ productionEndpoints: [] }))).toBe("E_PRODUCTION_MISSING"));
  it("blocks an undefined list", () => expect(codeOf(() => run({ productionEndpoints: undefined }))).toBe("E_PRODUCTION_MISSING"));
  it("blocks a blank entry", () => expect(codeOf(() => run({ productionEndpoints: [" "] }))).toBe("E_PRODUCTION_MISSING"));
  it("blocks a production entry that cannot be read as an endpoint", () => expect(codeOf(() => run({ productionEndpoints: ["prod"] }))).toBe("E_ENDPOINT_FORMAT"));
  it("blocks a production entry that is a name, not an endpoint", () => expect(codeOf(() => run({ productionEndpoints: ["my-production-database"] }))).toBe("E_ENDPOINT_FORMAT"));
  it("blocks when only one of two production entries is unreadable", () => expect(codeOf(() => run({ productionEndpoints: [host(PROD), "nonsense"] }))).toBe("E_ENDPOINT_FORMAT"));
  it("blocks a missing input object", () => expect(codeOf(() => checkRehearsalTarget(undefined as unknown as Input))).toBe("E_BRANCH_MISSING"));
});

describe("what is allowed", () => {
  it("a pooled staging endpoint", () => {
    const t = run({ connectionString: url(host(STAGING, true)) });
    expect(t).toMatchObject({ mode: "neon", endpointId: STAGING, pooled: true, branch: "staging-0007", port: 5432, database: "neondb" });
  });
  it("a direct staging endpoint", () => expect(run()).toMatchObject({ endpointId: STAGING, pooled: false }));
  it("production typed in any form, when staging is another endpoint", () => {
    for (const typed of [host(PROD), host(PROD, true), `${host(PROD)}:5432`, PROD, url(host(PROD)), host(PROD).toUpperCase()]) {
      expect(codeOf(() => run({ productionEndpoints: [typed] }))).toBe("ALLOWED");
    }
  });
  it("several production endpoints", () => expect(codeOf(() => run({ productionEndpoints: [host(PROD), host(PROD, true), "ep-prod-read-dddd4444"] }))).toBe("ALLOWED"));
  it("returns a frozen target that carries no credential", () => {
    const t = run();
    expect(Object.isFrozen(t)).toBe(true);
    expect(JSON.stringify(t)).not.toContain(PW);
    expect(JSON.stringify(t)).not.toContain("owner");
  });
});

describe("endpointIdOf reads the same endpoint from every way of writing it", () => {
  it.each([
    [host(PROD)],
    [host(PROD, true)],
    [`${host(PROD)}:5432`],
    [`${host(PROD, true)}.`],
    [host(PROD).toUpperCase()],
    [`postgresql://u:p@${host(PROD, true)}:5432/neondb?sslmode=require`],
    [`  ${PROD}  `],
    [PROD],
    [`${PROD}:5432`],
    [`${PROD}.`],
    [`${PROD}-pooler`],
  ])("%s", (typed) => expect(endpointIdOf(typed)).toBe(PROD));
  it.each([[""], ["   "], ["localhost"], ["ep-a-b"], [`${PROD} x`], ["ep-prod-main-аaaa1111"]])("refuses %j", (typed) => expect(() => endpointIdOf(typed)).toThrow(GuardError));
  it("refuses a non-string", () => expect(() => endpointIdOf(42 as unknown as string)).toThrow(GuardError));
});

describe("a local rehearsal (a disposable database on this machine)", () => {
  const local = (h: string, db: string, port = "5433") => `postgresql://owner:${PW}@${h}:${port}/${db}`;
  it("allows a disposable database on localhost", () => expect(checkLocalTarget({ connectionString: local("localhost", "gloss_f8stg_1793596997") })).toMatchObject({ mode: "local", database: "gloss_f8stg_1793596997" }));
  it("allows 127.0.0.1 and a rehearsal_ name", () => expect(checkLocalTarget({ connectionString: local("127.0.0.1", "rehearsal_one") }).mode).toBe("local"));
  it.each([
    ["the developer database", local("localhost", "gloss"), "E_LOCAL_DB"],
    ["a database with any other name", local("localhost", "plataforma"), "E_LOCAL_DB"],
    ["a Neon host", url(host(STAGING)), "E_LOCAL_HOST"],
    ["a remote host", local("db.example.com", "gloss_f8stg_1793596997"), "E_LOCAL_HOST"],
    ["a parameter that redirects", `${local("localhost", "gloss_f8stg_1793596997")}?host=${host(PROD)}`, "E_URL_PARAMS"],
  ])("blocks %s", (_n, cs, code) => expect(codeOf(() => checkLocalTarget({ connectionString: cs }))).toBe(code));
});

describe("the database driver must read the target as the guard did", () => {
  it("matches for a real driver object built from the validated string (no connection is made: the driver is lazy)", () => {
    const cs = url(host(STAGING, true), { port: "5432" });
    const target = run({ connectionString: cs });
    const sql = postgres(cs, { max: 1, prepare: false });
    try {
      expect(() => assertDriverMatches(sql.options, target)).not.toThrow();
    } finally {
      void sql.end({ timeout: 0 });
    }
  });
  it("refuses a driver that reads another host, port or database", () => {
    const target = run();
    expect(codeOf(() => assertDriverMatches({ host: [host(PROD)], port: [5432], database: "neondb" }, target))).toBe("E_DRIVER_MISMATCH");
    expect(codeOf(() => assertDriverMatches({ host: [host(STAGING)], port: [6543], database: "neondb" }, target))).toBe("E_DRIVER_MISMATCH");
    expect(codeOf(() => assertDriverMatches({ host: [host(STAGING)], port: [5432], database: "other" }, target))).toBe("E_DRIVER_MISMATCH");
    expect(codeOf(() => assertDriverMatches({ host: [host(STAGING), host(PROD)], port: [5432, 5432], database: "neondb" }, target))).toBe("E_DRIVER_MISMATCH");
    expect(codeOf(() => assertDriverMatches(undefined, target))).toBe("E_DRIVER_MISMATCH");
  });
});

describe("the migrating child inherits nothing about any database", () => {
  it("drops database variables and adds only what is passed", () => {
    const env = cleanChildEnv(
      { PATH: "/bin", HOME: "/h", PGHOST: "x", PGPASSWORD: "x", PGSERVICE: "x", DATABASE_URL: "x", DATABASE_URL_UNPOOLED: "x", POSTGRES_URL: "x", NEON_API_KEY: "x", VERCEL_ENV: "preview", VERCEL_TOKEN: "x", REHEARSAL_DATABASE_URL: "x", PRODUCTION_HOST: "x", STAGING_ENDPOINT: "x", pgsslmode: "x" },
      { DATABASE_URL: "given", VERCEL_ENV: "production" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", DATABASE_URL: "given", VERCEL_ENV: "production" });
  });
});

it("masks an endpoint id for output files", () => expect(maskEndpoint(STAGING)).toBe("ep-***-2222"));
