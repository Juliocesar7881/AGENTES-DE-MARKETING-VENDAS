/**
 * DEMO "Simulate Day" from the command line (same code path as the dashboard button):
 *   pnpm simulate [--contents 2]
 * Only DEMO workspaces are touched. With the worker running, renders are real MP4s.
 */
import { configureCore, ensureDemoAccount, simulateDay } from "@revenueos/core";
import { closeDb, eq, getDb, workspaces } from "@revenueos/database";
import { serializeError } from "@revenueos/shared";
import { loadDotEnv } from "../config";

loadDotEnv();

async function main(): Promise<void> {
  configureCore({ runnerId: "cli-simulate" });
  const i = process.argv.indexOf("--contents");
  const contentsPerWorkspace = i > 0 ? Number(process.argv[i + 1]) : 2;
  let demo = await getDb().select().from(workspaces).where(eq(workspaces.environment, "DEMO"));
  if (demo.length === 0) {
    process.stdout.write("No demo workspaces yet — creating them…\n");
    await ensureDemoAccount();
    demo = await getDb().select().from(workspaces).where(eq(workspaces.environment, "DEMO"));
  }
  const t0 = Date.now();
  const r = await simulateDay({ workspaceIds: demo.map((w) => w.id), contentsPerWorkspace });
  for (const w of r.workspaces) {
    process.stdout.write(`  ${w.name.padEnd(20)} contents ${w.contents}  published ${w.published}  leads ${w.leads}  checkouts ${w.checkouts}  sales ${w.sales}  revenue R$ ${(w.revenueCents / 100).toFixed(2)}\n`);
  }
  if (r.realRendersQueued) process.stdout.write(`  ${r.realRendersQueued} real render(s) queued for the local worker.\n`);
  process.stdout.write(`Simulated day finished in ${((Date.now() - t0) / 1000).toFixed(1)}s (DEMO data only).\n`);
}

main()
  .catch((e) => {
    process.stderr.write(`Simulation failed: ${serializeError(e).userMessage}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
