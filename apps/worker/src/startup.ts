import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./config";

/**
 * "Start with the computer" — opt-in only, visible and fully reversible:
 *  - Windows: a named value in HKCU\...\CurrentVersion\Run (listed in Task
 *    Manager → Startup apps, where the user can also disable it).
 *  - Linux: ~/.config/autostart/revenueos-worker.desktop
 *  - macOS: ~/Library/LaunchAgents/app.revenueos.worker.plist
 * Nothing is hidden, no services are installed, no admin rights are used.
 */
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "RevenueOSWorker";

export interface StartupStatus {
  supported: boolean;
  enabled: boolean;
  mechanism: string;
  command: string;
}

function windowsCommand(): string {
  const script = join(REPO_ROOT, "scripts", "windows", "start-worker.ps1");
  return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Hidden`;
}

function linuxDesktopFile(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "autostart", "revenueos-worker.desktop");
}

function macPlist(): string {
  return join(homedir(), "Library", "LaunchAgents", "app.revenueos.worker.plist");
}

export function startupStatus(): StartupStatus {
  if (process.platform === "win32") {
    const r = spawnSync("reg.exe", ["query", RUN_KEY, "/v", VALUE_NAME], { encoding: "utf8", windowsHide: true });
    return { supported: true, enabled: r.status === 0, mechanism: `Registry: ${RUN_KEY}\\${VALUE_NAME}`, command: windowsCommand() };
  }
  if (process.platform === "darwin") return { supported: true, enabled: existsSync(macPlist()), mechanism: `LaunchAgent: ${macPlist()}`, command: `${process.execPath} ${join(REPO_ROOT, "apps", "worker", "src", "index.ts")}` };
  return { supported: true, enabled: existsSync(linuxDesktopFile()), mechanism: `Autostart entry: ${linuxDesktopFile()}`, command: `sh -c 'cd "${REPO_ROOT}" && pnpm worker'` };
}

export function setStartup(enabled: boolean): StartupStatus {
  if (process.platform === "win32") {
    const args = enabled ? ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", windowsCommand(), "/f"] : ["delete", RUN_KEY, "/v", VALUE_NAME, "/f"];
    const r = spawnSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
    if (r.status !== 0 && enabled) throw new Error(`Could not update the startup entry: ${(r.stderr || r.stdout || "").trim()}`);
    return startupStatus();
  }
  if (process.platform === "darwin") {
    if (!enabled) rmSync(macPlist(), { force: true });
    else {
      mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
      const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
      writeFileSync(
        macPlist(),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.revenueos.worker</string>
  <key>ProgramArguments</key><array><string>${tsx}</string><string>${join(REPO_ROOT, "apps", "worker", "src", "index.ts")}</string></array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
`,
      );
    }
    return startupStatus();
  }
  const file = linuxDesktopFile();
  if (!enabled) rmSync(file, { force: true });
  else {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `[Desktop Entry]\nType=Application\nName=RevenueOS Worker\nComment=Local render and AI worker for RevenueOS\nExec=sh -c 'cd "${REPO_ROOT}" && pnpm worker'\nX-GNOME-Autostart-enabled=true\n`);
  }
  return startupStatus();
}
