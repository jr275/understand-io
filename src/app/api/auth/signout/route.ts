import { clearSession } from "@/lib/server/auth";

export async function POST() {
  await clearSession();
  return new Response(null, { status: 204 });
}
