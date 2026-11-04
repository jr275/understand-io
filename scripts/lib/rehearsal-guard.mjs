// The safety guard of the migration rehearsal (scripts/migration-rehearsal.mjs, scripts/neon-rehearsal.sh).
//
// The rehearsal CHANGES the database it is given (it applies a migration, drops the new table and applies it again). It must never be able to
// reach production, so this module decides, before any connection is made, whether a target is acceptable. It is pure: no network, no file, no
// environment, no output. It fails closed: every check that cannot be answered with a clear yes throws a GuardError and the rehearsal stops.
//
// What is checked, and why a plain comparison of host names is not enough (one endpoint has several spellings: pooled and direct, with and
// without a port, in any case):
//   1. The staging connection string must match one strict grammar (so the driver and this module read the same host, port and database, and no
//      parameter can redirect it). Only a few harmless parameters are accepted; `host`, `hostaddr`, `options`, `port`, `dbname`, `user`... are not.
//   2. The identity of a target is its ENDPOINT ID (`ep-<word>-<word>-<8 characters>`), taken from the host after removing `-pooler`, the port and
//      the domain. Production is identified the same way, from whatever the owner typed (a host, a host with a port, a URL, or the bare id).
//   3. The staging endpoint is stated explicitly, must equal the endpoint inside the connection string, and the owner must type the confirmation
//      `<branch>@<endpoint>`: that ties the branch name to the endpoint the connection string reaches.
//   4. A staging endpoint that is the production endpoint, or looks like it (same 8-character suffix, same two words, or within 3 edits), is refused
//      as ambiguous. Anything that cannot be parsed is refused. There is no fallback.
//   5. The branch name must be `staging-...` and cannot be a name that stands for the main branch.
// Error messages never contain the connection string, the user or the password.

export class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GuardError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new GuardError(code, message);
};

/** The Neon domain. Tests (and only the `--guard-only` dry run) may add `.invalid`, which can never resolve, so it can never reach a server. */
export const NEON_SUFFIXES = Object.freeze([".neon.tech"]);
export const DRY_RUN_SUFFIXES = Object.freeze([".neon.tech", ".invalid"]);

const ENDPOINT_RE = /^ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]{8}$/;
const BRANCH_RE = /^staging-[a-z0-9][a-z0-9._-]{0,48}$/;
const RESERVED_AFTER_PREFIX = new Set(["main", "master", "prod", "production", "default", "primary", "live"]);
// One canonical shape, read the same way by this module and by the driver. No second host, no IPv6 or numeric host, no unencoded `@` or `/`.
const URL_RE = /^(postgres|postgresql):\/\/([A-Za-z0-9._-]{1,63}):([A-Za-z0-9._~%+=!$*-]{1,256})@([a-z0-9.-]{1,253})(?::(\d{1,5}))?\/([A-Za-z0-9_]{1,63})(?:\?([A-Za-z0-9=&_.%-]*))?$/;
const NEON_HOST_RE = /^(ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]{8})(-pooler)?((?:\.[a-z0-9-]+)+)$/;
const PARAMS = {
  sslmode: /^(require|verify-ca|verify-full)$/,
  channel_binding: /^(require|prefer|disable)$/,
  connect_timeout: /^\d{1,3}$/,
};
const LOCAL_DB_RE = /^(gloss_[a-z0-9]+_[0-9]{6,}|rehearsal_[a-z0-9_]+)$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * The endpoint id of whatever the owner typed: a host, a host with a port, a pooled host, a URL, or the bare id. Case, a trailing dot, `-pooler`,
 * the port and the domain are removed. Anything that does not end up as a valid endpoint id throws: an identification that cannot be read is
 * never treated as "not production".
 */
export function endpointIdOf(raw) {
  if (typeof raw !== "string") fail("E_ENDPOINT_FORMAT", "An endpoint was not given as text.");
  let s = raw.trim().toLowerCase();
  if (!s || /[^\x21-\x7e]/.test(s)) fail("E_ENDPOINT_FORMAT", "An endpoint is empty, contains a space or contains a character that is not plain ASCII.");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0];
  const at = s.lastIndexOf("@");
  if (at !== -1) s = s.slice(at + 1);
  s = s.replace(/:\d{1,5}$/, "").replace(/\.+$/, "");
  const id = s.split(".")[0].replace(/-pooler$/, "");
  if (!ENDPOINT_RE.test(id)) fail("E_ENDPOINT_FORMAT", "An endpoint could not be read as a Neon endpoint id (expected ep-<word>-<word>-<8 characters>, optionally a host).");
  return id;
}

function parseParams(query) {
  const out = {};
  if (!query) return out;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? "" : pair.slice(eq + 1);
    if (!Object.hasOwn(PARAMS, k)) fail("E_URL_PARAMS", `The connection string has a parameter that is not accepted (${/^[A-Za-z0-9_]{1,24}$/.test(k) ? k : "unreadable"}). Remove it.`);
    if (Object.hasOwn(out, k)) fail("E_URL_PARAMS", `The connection string repeats the parameter ${k}.`);
    if (!PARAMS[k].test(v)) fail("E_URL_PARAMS", `The connection string has an unacceptable value for ${k}.`);
    out[k] = v;
  }
  return out;
}

function parseUrl(connectionString, { anyPort = false } = {}) {
  if (typeof connectionString !== "string" || !connectionString) fail("E_MISSING", "The staging connection string is missing.");
  const m = URL_RE.exec(connectionString);
  if (!m) fail("E_URL", "The staging connection string is not in the one accepted shape: postgresql://user:password@host[:5432]/database[?sslmode=...]. (Its content is not shown.)");
  const [, , , , host, port, database, query] = m;
  if (port !== undefined && !anyPort && port !== "5432") fail("E_PORT", "The staging connection string names a port other than 5432.");
  if (port !== undefined && anyPort && !/^[1-9]\d{0,4}$/.test(port)) fail("E_PORT", "The connection string names a port that is not a plain number.");
  parseParams(query);
  return { host, port: port === undefined ? 5432 : Number(port), database };
}

function parseNeonHost(host, suffixes) {
  const m = NEON_HOST_RE.exec(host);
  if (!m) fail("E_HOST", "The staging host is not a Neon endpoint host (ep-<word>-<word>-<8 characters>[-pooler].<domain>).");
  const [, endpointId, pooler, domain] = m;
  if (!suffixes.some((s) => domain.endsWith(s))) fail("E_HOST_SUFFIX", "The staging host is not in an accepted Neon domain.");
  if (domain.includes("..") || domain.endsWith(".") || domain.endsWith("-")) fail("E_HOST", "The staging host is malformed.");
  return { endpointId, pooled: pooler === "-pooler" };
}

function similar(a, b) {
  if (a === b) return "is the production endpoint";
  if (a.slice(-8) === b.slice(-8)) return "has the same 8-character suffix as the production endpoint";
  if (a.slice(0, -9) === b.slice(0, -9)) return "has the same two words as the production endpoint";
  if (levenshtein(a, b) <= 3) return "is within 3 edits of the production endpoint";
  return null;
}

/**
 * Decide whether a Neon branch may be rehearsed on. Throws a GuardError (and nothing else is allowed to happen) unless every rule holds.
 * @param {{connectionString?: string, branch?: string, endpoint?: string, productionEndpoints?: string[], confirmation?: string}} input
 * @param {{suffixes?: readonly string[]}} [options]
 */
export function checkRehearsalTarget(input, options = {}) {
  const suffixes = options.suffixes ?? NEON_SUFFIXES;
  const { connectionString, branch, endpoint, productionEndpoints, confirmation } = input ?? {};
  if (typeof branch !== "string" || !branch) fail("E_BRANCH_MISSING", "The staging branch name is missing.");
  if (typeof endpoint !== "string" || !endpoint.trim()) fail("E_ENDPOINT_MISSING", "The staging endpoint is not stated.");
  if (!Array.isArray(productionEndpoints) || productionEndpoints.length === 0 || productionEndpoints.some((p) => typeof p !== "string" || !p.trim())) {
    fail("E_PRODUCTION_MISSING", "The production endpoint is not stated. It is required, so that the staging target can be compared with it.");
  }
  if (typeof confirmation !== "string" || !confirmation.trim()) fail("E_CONFIRMATION_MISSING", "The confirmation is missing (type <branch>@<endpoint>).");

  if (!BRANCH_RE.test(branch) || RESERVED_AFTER_PREFIX.has(branch.slice("staging-".length))) {
    fail("E_BRANCH", "The branch name must be staging-<name> (lower case) and cannot stand for the main branch.");
  }
  const url = parseUrl(connectionString);
  const { endpointId, pooled } = parseNeonHost(url.host, suffixes);

  const stated = endpointIdOf(endpoint);
  if (stated !== endpointId) fail("E_ENDPOINT_MISMATCH", "The staging endpoint you stated is not the endpoint the connection string reaches.");
  if (confirmation.trim() !== `${branch}@${endpointId}`) fail("E_CONFIRMATION", "The confirmation does not read <branch>@<endpoint> for this branch and endpoint.");

  const production = productionEndpoints.map(endpointIdOf);
  for (const p of production) {
    const why = similar(endpointId, p);
    if (why) fail(why === "is the production endpoint" ? "E_IS_PRODUCTION" : "E_AMBIGUOUS", `The staging endpoint ${why}. Nothing was touched.`);
  }
  return Object.freeze({ mode: "neon", branch, endpointId, pooled, host: url.host, port: url.port, database: url.database });
}

/** A disposable database on this machine (a rehearsal of the mechanism, not of Neon). Never the developer database `gloss`. */
export function checkLocalTarget(input) {
  const { connectionString } = input ?? {};
  const url = parseUrl(connectionString, { anyPort: true });
  if (!LOCAL_HOSTS.has(url.host)) fail("E_LOCAL_HOST", "A local rehearsal accepts only localhost or 127.0.0.1.");
  if (!LOCAL_DB_RE.test(url.database)) fail("E_LOCAL_DB", "A local rehearsal accepts only a disposable database named gloss_<tag>_<number> or rehearsal_<name>, never the developer database.");
  return Object.freeze({ mode: "local", host: url.host, port: url.port, database: url.database });
}

/** The driver must read the same host, port and database as the guard did; if it does not, nothing is run. */
export function assertDriverMatches(driverOptions, target) {
  const host = driverOptions?.host;
  const port = driverOptions?.port;
  const ok = Array.isArray(host) && host.length === 1 && host[0] === target.host && Array.isArray(port) && port.length === 1 && Number(port[0]) === target.port && driverOptions.database === target.database;
  if (!ok) fail("E_DRIVER_MISMATCH", "The database driver reads the target differently from the guard. Nothing was touched.");
}

const AMBIENT = /^(PG[A-Z_]*|POSTGRES.*|DATABASE.*|NEON.*|VERCEL.*|REHEARSAL.*|PRODUCTION.*|STAGING.*)$/i;

/** The environment of the child process that migrates: nothing database-related is inherited, only what is passed explicitly. */
export function cleanChildEnv(env, extra) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!AMBIENT.test(k) && v !== undefined) out[k] = v;
  return { ...out, ...extra };
}

/** Short, non-identifying form of an endpoint id for output files. */
export const maskEndpoint = (id) => `ep-***-${id.slice(-4)}`;
