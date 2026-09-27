import { closeDb } from "../src/client";
import { resetDatabase } from "../src/migrate";
import { loadEnv } from "./env";

loadEnv();
try {
  await resetDatabase();
  console.info("✔ Database reset and migrated.");
} catch (e) {
  console.error("✖ Reset failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
