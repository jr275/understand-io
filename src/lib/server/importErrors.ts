import { ReadError } from "@/lib/content/errors";
import { UnsafeUrlError } from "./safeFetch";

/**
 * Response for an error thrown while importing. Only messages written for the reader (ReadError, UnsafeUrlError) are shown;
 * anything else is replaced by a fixed text and logged by name only, because library, parser and driver messages can carry
 * SQL, parameters, document content or internal paths. `fetching` marks routes that call out to a site, where a failed
 * fetch (a TypeError from fetch) means "could not be reached".
 */
export function importErrorResponse(err: unknown, fallback: string, fetching = false): Response {
  if (err instanceof UnsafeUrlError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof ReadError) return Response.json({ error: err.message }, { status: 422 });
  if (fetching && err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return Response.json({ error: "That page took too long to answer." }, { status: 504 });
  if (fetching && err instanceof TypeError) return Response.json({ error: "That page could not be reached." }, { status: 502 });
  console.warn(`[import] unexpected failure (${err instanceof Error ? err.name : typeof err})`);
  return Response.json({ error: fallback }, { status: 500 });
}
