import { currentAccount, googleConfig } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Who is signed in (if anyone) and whether sign-in is available on this server. */
export async function GET() {
  try {
    const acc = await currentAccount();
    return Response.json({
      configured: !!googleConfig(),
      account: acc ? { name: acc.name, email: acc.email, picture: acc.picture } : null,
    });
  } catch {
    // Never break a page over the account badge: report "signed out" and leave sign-in unavailable.
    return Response.json({ configured: false, account: null, error: "unavailable" }, { status: 200 });
  }
}
