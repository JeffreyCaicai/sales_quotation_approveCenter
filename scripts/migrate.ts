import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDb, getDb } from "../db/index";

async function main() {
  try {
    await migrate(getDb(), { migrationsFolder: "drizzle" });
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
