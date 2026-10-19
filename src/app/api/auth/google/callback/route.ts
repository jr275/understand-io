import { appOrigin, exchangeGoogleCode, googleConfig, readOAuthCookie, redirectUri, safeNext, signInFailure, signInGoogle, writeSession } from "@/lib/server/auth";
import { getReaderId } from "@/lib/server/reader";

export async function GET(req: Request) {
  let origin: string;
  try {
    origin = appOrigin(req);
  } catch (err) {
    return Response.json({ error: "not-configured", message: err instanceof Error ? err.message : "APP_URL is not set." }, { status: 503 });
  }
  const back = (msg: string) => Response.redirect(`${origin}/?signin=${encodeURIComponent(msg)}`, 302);
  const cfg = googleConfig();
  if (!cfg) return back("Sign-in is not set up on this server.");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = await readOAuthCookie();
  if (url.searchParams.get("error")) return back("Google sign-in was cancelled.");
  if (!code || !state || !saved || saved.state !== state) return back("The sign-in link was stale. Please try again.");
  try {
    const profile = await exchangeGoogleCode(cfg, code, saved.verifier, redirectUri(req));
    const account = await signInGoogle(profile, await getReaderId());
    await writeSession(account);
    return Response.redirect(`${origin}${safeNext(saved.next)}`, 302);
  } catch (err) {
    return back(signInFailure(err));
  }
}
