/** Error codes (Node socket errors, postgres.js, PostgreSQL SQLSTATE) that mean "the database is not reachable right now". */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (starting up / shutting down)
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "53300", // too_many_connections
]);

/**
 * True when `err`, or anything it wraps, is a connection-level failure. Drizzle wraps driver errors in
 * `cause`, and Node reports a refused dual-stack connect as an `AggregateError` with `errors[]`.
 */
export function isConnectionError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string" && CONNECTION_CODES.has(e.code)) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => isConnectionError(x, depth + 1))) return true;
  return isConnectionError(e.cause, depth + 1);
}

/** Short, query-free description for server logs (drizzle error messages embed the SQL and its parameters). */
export function describeDbError(err: unknown): string {
  const code = (err as { code?: string; cause?: { code?: string } } | null)?.code ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
  return code ? `code ${code}` : err instanceof Error ? err.name : "unknown error";
}
