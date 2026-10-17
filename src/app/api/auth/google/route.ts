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
  const next = new URL(req.url).searchParams.get("next") ?? "/library";
  const s = newOAuthState(next);
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
