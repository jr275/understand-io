import { analyticsMode } from "@/lib/server/analytics";
import { codeChallenge, googleConfig, newOAuthState, redirectUri, writeOAuthCookie } from "@/lib/server/auth";

/** Start Google sign-in. Answers 503 with a clear message when the server has no credentials. */
export async function GET(req: Request) {
  const cfg = googleConfig();
  if (!cfg) return Response.json({ error: "not-configured", message: "Sign-in is not set up on this server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and DATABASE_URL are needed)." }, { status: 503 });
  let redirect: string;
  try {
    redirect = redirectUri(req);
  } catch (err) {
    return Response.json({ error: "not-configured", message: err instanceof Error ? err.message : "APP_URL is not set." }, { status: 503 });
  }
  const params = new URL(req.url).searchParams;
  const next = params.get("next") ?? "/library";
  // First-touch attribution from the tab (only sent when analytics is in `full` mode); untrusted, so it is re-validated inside.
  let attr: unknown;
  try {
    const raw = params.get("attr");
    attr = raw && raw.length < 600 && analyticsMode() === "full" ? JSON.parse(raw) : undefined;
  } catch {
    attr = undefined;
  }
  const s = newOAuthState(next, attr);
  await writeOAuthCookie(s);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", s.state);
  u.searchParams.set("code_challenge", codeChallenge(s.verifier));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return Response.redirect(u.toString(), 302);
}
