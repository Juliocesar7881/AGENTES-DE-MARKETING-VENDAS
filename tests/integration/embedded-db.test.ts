import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { findFreePort, migrationStatus, runMigrations, startEmbeddedPostgres, stopEmbeddedPostgres, stopEmbeddedPostgresByDataDir } from "@revenueos/database";

// PostgreSQL refuses to run as root; in root-only containers set REVENUEOS_PG_CREATE_USER=1.
const canRun = process.platform === "win32" || userInfo().uid !== 0 || process.env.REVENUEOS_PG_CREATE_USER === "1";

describe.skipIf(!canRun)("built-in database (embedded PostgreSQL)", () => {
  const parent = mkdtempSync(join(tmpdir(), "rvos-pg-"));
  chmodSync(parent, 0o755); // the separate postgres user (root containers) must reach the data folder
  const dataDir = join(parent, "pgdata");
  let port = 0;
  const password = "test-Pass-123";
  afterAll(async () => {
    await stopEmbeddedPostgres().catch(() => undefined);
    await stopEmbeddedPostgresByDataDir(dataDir).catch(() => undefined);
  });

  it("creates, starts and migrates a private PostgreSQL (tables + RLS roles)", async () => {
    port = await findFreePort(55433);
    const r = await startEmbeddedPostgres({ port, password, dataDir });
    expect(r.started).toBe(true);
    expect(r.initialised).toBe(true);
    await runMigrations(r.url);
    const m = await migrationStatus(r.url);
    expect(m.applied).toBe(m.total);
    const c = postgres(r.url, { max: 1, onnotice: () => {} });
    await c`insert into system_settings (key, value) values ('embedded_probe', '"kept"'::jsonb)`;
    const [role] = await c`select rolbypassrls from pg_roles where rolname = 'revenueos_app'`;
    expect(role?.rolbypassrls).toBe(false);
    const [listen] = await c`select current_setting('listen_addresses') as v`;
    expect(listen?.v).toBe("127.0.0.1");
    await c.end();
  }, 180_000);

  it("stops by data folder and keeps the data after a restart", async () => {
    await stopEmbeddedPostgres();
    expect(await stopEmbeddedPostgresByDataDir(dataDir)).toBe(false); // already stopped
    const r = await startEmbeddedPostgres({ port, password, dataDir });
    expect(r.initialised).toBe(false);
    const c = postgres(r.url, { max: 1, onnotice: () => {} });
    const [row] = await c`select value from system_settings where key = 'embedded_probe'`;
    expect(row?.value).toBe("kept");
    await c.end();
    // A server started by another process (e.g. the dashboard during installation) is stopped via its pid file.
    expect(await stopEmbeddedPostgresByDataDir(dataDir)).toBe(true);
  }, 180_000);
});
