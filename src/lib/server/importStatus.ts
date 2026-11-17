/** Turn a non-OK upstream status into the message and HTTP status the import API returns. */
export function describeFetchStatus(status: number): { status: number; error: string; blocked: boolean } {
  if (status === 401 || status === 403 || status === 429 || status === 451 || status === 999) {
    return {
      status: 422,
      blocked: true,
      error: "That site blocks readers like this one. Open the page in your browser and use the “Read in Keeple” bookmarklet, or paste its text.",
    };
  }
  if (status === 402) {
    return { status: 422, blocked: true, error: "That page asks for payment or a subscription (402), so it cannot be read here. If you have access, open it in your browser and use the “Read in Keeple” bookmarklet, or paste its text." };
  }
  if (status === 404 || status === 410) return { status: 404, blocked: false, error: "That page no longer exists (404)." };
  if (status >= 500) return { status: 502, blocked: false, error: `That site is having trouble (it answered ${status}). Try again in a moment.` };
  return { status: 502, blocked: false, error: `That page answered ${status}.` };
}
