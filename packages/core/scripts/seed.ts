import { closeDb } from "@revenueos/database";
import { seedDemo } from "../src/demo/seed";
import { loadEnv } from "./env";

loadEnv();
try {
  const simulate = !process.argv.includes("--no-simulate");
  const t0 = Date.now();
  const r = await seedDemo({ simulate });
  console.info(`✔ Demo ready in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${r.workspaces.map((w) => w.name).join(", ")}`);
  console.info(`  Login: ${r.email} / ${r.password}`);
} catch (e) {
  console.error("✖ Seed failed:", e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
