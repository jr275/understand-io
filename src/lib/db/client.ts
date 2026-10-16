import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __glossDb: ReturnType<typeof makeDb> | undefined;
}

function makeDb(url: string) {
  const sql = postgres(url, { max: 5, prepare: false });
  return drizzle(sql, { schema });
}

/** Returns a Drizzle client when DATABASE_URL is configured, otherwise null (local-only mode). */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalThis.__glossDb) globalThis.__glossDb = makeDb(url);
  return globalThis.__glossDb;
}

export type Db = NonNullable<ReturnType<typeof getDb>>;
