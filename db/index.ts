import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;

export function getDb(): NodePgDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  pool ??= new Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
