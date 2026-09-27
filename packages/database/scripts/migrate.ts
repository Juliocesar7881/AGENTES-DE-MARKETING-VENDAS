import { closeDb } from "../src/client";
import { runMigrations } from "../src/migrate";
import { loadEnv } from "./env";

loadEnv();
try {
  await runMigrations();
  console.info("✔ Database migrations applied.");
} catch (e) {
  console.error("✖ Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
