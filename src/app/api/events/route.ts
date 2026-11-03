import { handleEvents } from "@/lib/server/analytics";

/** Product analytics collector (`docs/product/analytics.md`). Answers 204 whatever it did; the `x-gloss-analytics` header tells the browser the mode (`off` also for Do Not Track). */
export async function POST(req: Request) {
  return handleEvents(req);
}
