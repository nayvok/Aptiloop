import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { windowsShortcutArguments } from "./shortcuts.js";
export interface ServiceRuntimeConfig {
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly dataDir: string;
  readonly webLog: string;
  readonly orchestratorLog: string;
}

export interface ServiceStartCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function buildAptiloopStartCommand(
  cliEntry: string,
  config: ServiceRuntimeConfig,
): ServiceStartCommand {
  return {
    executable: process.execPath,
    args: [cliEntry, "start", "--service-run", "--data-dir", config.dataDir],
  };
}

export type ServiceAction =
  "install" | "start" | "stop" | "restart" | "status" | "uninstall";

export interface ServiceResult {
  readonly message: string;
}

const SERVICE_TIMEOUT_MS = 30_000;
const MACOS_PLIST_LABEL = "com.aptiloop.service";
const LINUX_UNIT_NAME = "aptiloop.service";
const WINDOWS_TASK_NAME = "Aptiloop";

function runFixed(
  executable: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(executable, [...args], {
    shell: false,
    encoding: "utf8",
    timeout: SERVICE_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export async function serviceInstall(
  config: ServiceRuntimeConfig,
  platformName: string,
  autostart: boolean,
  start: ServiceStartCommand,
): Promise<ServiceResult> {
  if (platformName === "darwin")
    return installLaunchd(config, autostart, start);
  if (platformName === "linux") return installSystemd(config, autostart, start);
  if (platformName === "win32")
    return installScheduledTask(config, autostart, start);
  throw new Error(`service install is not supported on ${platformName}`);
}

export async function serviceStart(
  platformName: string,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    const result = runFixed("launchctl", ["load", plistPath()]);
    if (result.status !== 0) {
      throw new Error(`launchctl load failed: ${result.stderr.trim()}`);
    }
    const started = runFixed("launchctl", ["start", MACOS_PLIST_LABEL]);
    if (started.status !== 0) {
      throw new Error(`launchctl start failed: ${started.stderr.trim()}`);
    }
    return { message: "Aptiloop service started (launchd)." };
  }
  if (platformName === "linux") {
    const result = runFixed("systemctl", ["--user", "start", LINUX_UNIT_NAME]);
    if (result.status !== 0) {
      throw new Error(`systemctl start failed: ${result.stderr.trim()}`);
    }
    return { message: "Aptiloop service started (systemd user unit)." };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    if (result.status !== 0) {
      throw new Error(`schtasks run failed: ${result.stderr.trim()}`);
    }
    return { message: "Aptiloop scheduled task started." };
  }
  throw new Error(`service start is not supported on ${platformName}`);
}

export async function serviceStop(
  platformName: string,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    const result = runFixed("launchctl", ["unload", plistPath()]);
    if (result.status !== 0) {
      throw new Error(`launchctl unload failed: ${result.stderr.trim()}`);
    }
    return { message: "Aptiloop service stopped (launchd)." };
  }
  if (platformName === "linux") {
    const result = runFixed("systemctl", ["--user", "stop", LINUX_UNIT_NAME]);
    if (result.status !== 0) {
      throw new Error(`systemctl stop failed: ${result.stderr.trim()}`);
    }
    return { message: "Aptiloop service stopped (systemd user unit)." };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME]);
    if (result.status !== 0) {
      throw new Error(`schtasks end failed: ${result.stderr.trim()}`);
    }
    return { message: "Aptiloop scheduled task ended." };
  }
  throw new Error(`service stop is not supported on ${platformName}`);
}

export async function serviceRestart(
  platformName: string,
): Promise<ServiceResult> {
  await serviceStop(platformName);
  await serviceStart(platformName);
  return { message: "Aptiloop service restarted." };
}

export async function serviceStatus(
  platformName: string,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    const result = runFixed("launchctl", ["list", MACOS_PLIST_LABEL]);
    const running = result.status === 0;
    return {
      message: running
        ? `launchd service ${MACOS_PLIST_LABEL} is loaded.\n${result.stdout.trim()}`
        : `launchd service ${MACOS_PLIST_LABEL} is not loaded.`,
    };
  }
  if (platformName === "linux") {
    const active = runFixed("systemctl", [
      "--user",
      "is-active",
      LINUX_UNIT_NAME,
    ]);
    const enabled = runFixed("systemctl", [
      "--user",
      "is-enabled",
      LINUX_UNIT_NAME,
    ]);
    return {
      message: `systemd user unit ${LINUX_UNIT_NAME}: active=${active.stdout.trim() || "unknown"}, enabled=${enabled.stdout.trim() || "unknown"}.`,
    };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", [
      "/Query",
      "/TN",
      WINDOWS_TASK_NAME,
      "/FO",
      "LIST",
      "/V",
    ]);
    if (result.status !== 0) {
      return {
        message: `Scheduled task ${WINDOWS_TASK_NAME} is not installed.`,
      };
    }
    return { message: result.stdout.trim() };
  }
  throw new Error(`service status is not supported on ${platformName}`);
}

export async function serviceUninstall(
  platformName: string,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    runFixed("launchctl", ["unload", plistPath()]);
    try {
      await fs.unlink(plistPath());
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    return { message: "launchd service removed." };
  }
  if (platformName === "linux") {
    runFixed("systemctl", ["--user", "disable", "--now", LINUX_UNIT_NAME]);
    try {
      await fs.unlink(unitPath());
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    runFixed("systemctl", ["--user", "daemon-reload"]);
    return { message: "systemd user unit removed." };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", [
      "/Delete",
      "/TN",
      WINDOWS_TASK_NAME,
      "/F",
    ]);
    if (result.status !== 0) {
      throw new Error(`schtasks delete failed: ${result.stderr.trim()}`);
    }
    return { message: "Scheduled task removed." };
  }
  throw new Error(`service uninstall is not supported on ${platformName}`);
}

export async function setAutostart(
  config: ServiceRuntimeConfig,
  platformName: string,
  enabled: boolean,
  start: ServiceStartCommand,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    await ensureLaunchdInstalled(config, enabled, start);
    const result = runFixed("launchctl", [
      enabled ? "load" : "unload",
      plistPath(),
    ]);
    if (result.status !== 0) {
      throw new Error(
        `launchctl ${enabled ? "load" : "unload"} failed: ${result.stderr.trim()}`,
      );
    }
    return {
      message: enabled
        ? "Autostart enabled (launchd RunAtLoad)."
        : "Autostart disabled (launchd unit kept installed).",
    };
  }
  if (platformName === "linux") {
    await ensureSystemdInstalled(config, start);
    const result = runFixed("systemctl", [
      "--user",
      enabled ? "enable" : "disable",
      LINUX_UNIT_NAME,
    ]);
    if (result.status !== 0) {
      throw new Error(
        `systemctl ${enabled ? "enable" : "disable"} failed: ${result.stderr.trim()}`,
      );
    }
    return {
      message: enabled
        ? "Autostart enabled (systemd user unit)."
        : "Autostart disabled (systemd user unit kept installed).",
    };
  }
  if (platformName === "win32") {
    await ensureScheduledTaskInstalled(enabled, start);
    return {
      message: enabled
        ? "Autostart enabled (logon trigger)."
        : "Autostart disabled (scheduled task kept runnable manually).",
    };
  }
  throw new Error(`autostart is not supported on ${platformName}`);
}

export async function autostartStatus(
  platformName: string,
): Promise<ServiceResult> {
  if (platformName === "darwin") {
    let content: string;
    try {
      content = await fs.readFile(plistPath(), "utf8");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
      return { message: "Autostart: not installed (launchd unit absent)." };
    }
    const enabled = /<key>RunAtLoad<\/key>\s*<true\/>/u.test(content);
    return {
      message: `Autostart: ${enabled ? "enabled" : "disabled"} (launchd unit ${enabled ? "loads" : "does not load"} at login).`,
    };
  }
  if (platformName === "linux") {
    const result = runFixed("systemctl", [
      "--user",
      "is-enabled",
      LINUX_UNIT_NAME,
    ]);
    const state = result.stdout.trim() || "unknown";
    return { message: `Autostart: ${state} (systemd user unit).` };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", [
      "/Query",
      "/TN",
      WINDOWS_TASK_NAME,
      "/FO",
      "XML",
    ]);
    if (result.status !== 0) {
      return { message: "Autostart: not installed (scheduled task absent)." };
    }
    const parsed = parseScheduledTaskXmlEnabled(result.stdout);
    return {
      message:
        parsed === null
          ? "Autostart: scheduled task state unclear."
          : `Autostart: ${parsed ? "enabled" : "disabled"} (logon task).`,
    };
  }
  throw new Error(`autostart status is not supported on ${platformName}`);
}

export interface AutostartState {
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly detail: string;
}

export function parseScheduledTaskXmlEnabled(output: string): boolean | null {
  const trigger =
    /<LogonTrigger\b[\s\S]*?<Enabled>\s*(true|false)\s*<\/Enabled>[\s\S]*?<\/LogonTrigger>/iu.exec(
      output,
    );
  if (!trigger) return null;
  return /<Enabled>\s*true\s*<\/Enabled>/iu.test(trigger[0]);
}

export async function queryAutostart(
  platformName: string,
): Promise<AutostartState> {
  if (platformName === "darwin") {
    let fileEnabled = false;
    let installed = false;
    try {
      const content = await fs.readFile(plistPath(), "utf8");
      installed = true;
      fileEnabled = /<key>RunAtLoad<\/key>\s*<true\/>/u.test(content);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    const loaded = runFixed("launchctl", ["list", MACOS_PLIST_LABEL]);
    return {
      installed,
      enabled: fileEnabled,
      detail:
        installed || loaded.status === 0
          ? `launchd unit present=${installed}, loaded=${loaded.status === 0}, RunAtLoad=${fileEnabled}.`
          : "launchd unit absent.",
    };
  }
  if (platformName === "linux") {
    let installed = false;
    try {
      await fs.access(unitPath());
      installed = true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
    const result = runFixed("systemctl", [
      "--user",
      "is-enabled",
      LINUX_UNIT_NAME,
    ]);
    const state = result.stdout.trim().toLowerCase();
    const enabled = state === "enabled" || state === "enabled-runtime";
    return {
      installed: installed || result.status === 0,
      enabled,
      detail: `systemd user unit is-enabled=${state || "unknown"}.`,
    };
  }
  if (platformName === "win32") {
    const result = runFixed("schtasks", [
      "/Query",
      "/TN",
      WINDOWS_TASK_NAME,
      "/FO",
      "XML",
    ]);
    if (result.status !== 0) {
      return {
        installed: false,
        enabled: false,
        detail: "Scheduled task absent.",
      };
    }
    const parsed = parseScheduledTaskXmlEnabled(result.stdout);
    return {
      installed: true,
      enabled: parsed === true,
      detail:
        parsed === null
          ? "Scheduled task present; enabled state unclear."
          : `Scheduled task present; autostart ${parsed ? "enabled" : "disabled"}.`,
    };
  }
  throw new Error(`autostart status is not supported on ${platformName}`);
}

function plistPath(): string {
  return path.join(homedir(), "Library", "LaunchAgents", "aptiloop.plist");
}
function unitPath(): string {
  return path.join(homedir(), ".config", "systemd", "user", LINUX_UNIT_NAME);
}

async function installLaunchd(
  config: ServiceRuntimeConfig,
  autostart: boolean,
  start: ServiceStartCommand,
): Promise<ServiceResult> {
  await ensureLaunchdInstalled(config, autostart, start);
  runFixed("launchctl", ["unload", plistPath()]);
  const result = runFixed("launchctl", ["load", plistPath()]);
  if (result.status !== 0) {
    throw new Error(`launchctl load failed: ${result.stderr.trim()}`);
  }
  const started = runFixed("launchctl", ["start", MACOS_PLIST_LABEL]);
  if (started.status !== 0) {
    throw new Error(`launchctl start failed: ${started.stderr.trim()}`);
  }
  return {
    message: `launchd service installed (ports ${config.webPort}/${config.orchestratorPort}, data ${config.dataDir}, autostart ${autostart ? "on" : "off"}). Reinstall to change ports or data dir.`,
  };
}

async function ensureLaunchdInstalled(
  config: ServiceRuntimeConfig,
  autostart: boolean,
  start: ServiceStartCommand,
): Promise<void> {
  const { executable, args } = start;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key><string>${MACOS_PLIST_LABEL}</string>
<key>ProgramArguments</key>
<array>
<array-item-placeholder/>
</array>
<key>RunAtLoad</key><${autostart ? "true" : "false"}/>
<key>KeepAlive</key><${autostart ? "true" : "false"}/>
<key>StandardOutPath</key><string>${escapeXml(config.webLog)}</string>
<key>StandardErrorPath</key><string>${escapeXml(config.orchestratorLog)}</string>
</dict>
</plist>
`;
  const programArguments = [executable, ...args]
    .map((item) => `<string>${escapeXml(item)}</string>`)
    .join("\n");
  const rendered = plist.replace("<array-item-placeholder/>", programArguments);
  await fs.mkdir(path.dirname(plistPath()), { recursive: true });
  await fs.writeFile(plistPath(), rendered, { flag: "w" });
}

async function installSystemd(
  config: ServiceRuntimeConfig,
  autostart: boolean,
  start: ServiceStartCommand,
): Promise<ServiceResult> {
  await ensureSystemdInstalled(config, start);
  runFixed("systemctl", ["--user", "daemon-reload"]);
  const enable = runFixed("systemctl", [
    "--user",
    autostart ? "enable" : "disable",
    LINUX_UNIT_NAME,
  ]);
  if (enable.status !== 0) {
    throw new Error(`systemctl enable/disable failed: ${enable.stderr.trim()}`);
  }
  return {
    message: `systemd user unit installed (ports ${config.webPort}/${config.orchestratorPort}, data ${config.dataDir}, autostart ${autostart ? "on" : "off"}). Reinstall to change ports or data dir.`,
  };
}

async function ensureSystemdInstalled(
  config: ServiceRuntimeConfig,
  start: ServiceStartCommand,
): Promise<void> {
  const { executable, args } = start;
  const quoted = [executable, ...args]
    .map(
      (item) =>
        `"${item
          .replaceAll("\\", "\\\\")
          .replaceAll('"', '\\"')
          .replaceAll("$", "$$")
          .replaceAll("%", "%%")}"`,
    )
    .join(" ");
  const unit = `[Unit]
Description=Aptiloop local web and orchestrator (user service)
After=network-online.target

[Service]
Type=simple
ExecStart=${quoted}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  await fs.mkdir(path.dirname(unitPath()), { recursive: true });
  await fs.writeFile(unitPath(), unit, { flag: "w" });
}
async function installScheduledTask(
  config: ServiceRuntimeConfig,
  autostart: boolean,
  start: ServiceStartCommand,
): Promise<ServiceResult> {
  await ensureScheduledTaskInstalled(autostart, start);
  return {
    message: `Scheduled task installed (ports ${config.webPort}/${config.orchestratorPort}, data ${config.dataDir}, autostart ${autostart ? "on" : "off"}).`,
  };
}

export function setLogonTriggerEnabled(xml: string, enabled: boolean): string {
  const matches = xml.match(/<LogonTrigger\b[\s\S]*?<\/LogonTrigger>/giu) ?? [];
  if (
    matches.length !== 1 ||
    !/<Settings\b[\s\S]*?<Enabled>\s*true\s*<\/Enabled>[\s\S]*?<\/Settings>/iu.test(
      xml,
    )
  ) {
    throw new Error(
      "Scheduled task XML has an ambiguous trigger or disabled global settings.",
    );
  }
  const replacement = matches[0].replace(
    /(<Enabled>\s*)(true|false)(\s*<\/Enabled>)/iu,
    `$1${enabled ? "true" : "false"}$3`,
  );
  if (!/<Enabled>\s*(true|false)\s*<\/Enabled>/iu.test(matches[0])) {
    throw new Error("Scheduled task XML logon trigger state is invalid.");
  }
  return xml.replace(matches[0], replacement);
}

async function setScheduledTaskLogonEnabled(enabled: boolean): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const exported = runFixed("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Export-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}'`,
  ]);
  if (exported.status !== 0) return exported;
  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), "aptiloop-task-update-"),
  );
  const xmlPath = path.join(tempDir, "task.xml");
  try {
    await fs.writeFile(
      xmlPath,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(
          setLogonTriggerEnabled(exported.stdout, enabled),
          "utf16le",
        ),
      ]),
      { flag: "wx" },
    );
    return runFixed("schtasks", [
      "/Create",
      "/TN",
      WINDOWS_TASK_NAME,
      "/XML",
      xmlPath,
      "/F",
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
async function ensureScheduledTaskInstalled(
  logonEnabled: boolean,
  start: ServiceStartCommand,
): Promise<void> {
  const taskRun = windowsShortcutArguments([start.executable, ...start.args]);
  const result = runFixed("schtasks", [
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/TR",
    taskRun,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
  ]);
  if (result.status !== 0) {
    throw new Error(`schtasks create failed: ${result.stderr.trim()}`);
  }
  if (!logonEnabled) {
    const disabled = await setScheduledTaskLogonEnabled(false);
    if (disabled.status !== 0) {
      throw new Error(
        `scheduled task trigger change failed: ${disabled.stderr.trim()}`,
      );
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
