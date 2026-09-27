import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRootEnv, envFilePath, parseDotEnv, updateEnvFile } from "@revenueos/shared/server";

describe("configuration file written by the installer and the setup wizard", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rvos-env-"));
    process.env.REVENUEOS_ENV_FILE = join(dir, ".env");
    for (const k of ["RVOS_T_A", "RVOS_T_B", "RVOS_T_C", "RVOS_T_URL"]) delete process.env[k];
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses REVENUEOS_ENV_FILE when set (tests never touch the real .env)", () => {
    expect(envFilePath()).toBe(join(dir, ".env"));
  });

  it("updates keys in place, keeps comments and other lines, appends new keys", () => {
    writeFileSync(join(dir, ".env"), "# comment\nRVOS_T_A=old\n# RVOS_T_B=commented\nOTHER=1\n");
    updateEnvFile({ RVOS_T_A: "new", RVOS_T_B: "b" });
    const text = readFileSync(join(dir, ".env"), "utf8");
    expect(text).toContain("# comment\nRVOS_T_A=new\n# RVOS_T_B=commented\nOTHER=1");
    expect(text).toMatch(/Set by the RevenueOS installer[\s\S]*RVOS_T_B=b/);
    expect(process.env.RVOS_T_A).toBe("new");
    if (process.platform !== "win32") expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("round-trips values that need quoting", () => {
    const tricky = 'p@ss "word" #1 \\ end';
    updateEnvFile({ RVOS_T_C: tricky, RVOS_T_URL: "postgres://u:p%40ss@127.0.0.1:5433/revenueos" });
    const parsed = parseDotEnv(readFileSync(join(dir, ".env"), "utf8"));
    expect(parsed.RVOS_T_C).toBe(tricky);
    expect(parsed.RVOS_T_URL).toBe("postgres://u:p%40ss@127.0.0.1:5433/revenueos");
  });

  it("rejects invalid names and multi-line values", () => {
    expect(() => updateEnvFile({ "bad-name": "x" })).toThrow();
    expect(() => updateEnvFile({ RVOS_T_A: "a\nINJECTED=1" })).toThrow();
  });

  it("loading never overrides variables that are already set, including explicitly empty ones", () => {
    writeFileSync(join(dir, ".env"), "RVOS_T_A=from-file\nRVOS_T_B=from-file\n");
    process.env.RVOS_T_A = "";
    ensureRootEnv();
    expect(process.env.RVOS_T_A).toBe("");
    expect(process.env.RVOS_T_B).toBe("from-file");
  });
});
