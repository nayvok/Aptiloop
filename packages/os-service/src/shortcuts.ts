import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SHORTCUT_NAME = "Aptiloop";

export interface ShortcutCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function desktopQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}
function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
function windowsArgQuote(value: string): string {
  if (value !== "" && !/[ \t"]/u.test(value)) return value;
  return `"${value.replaceAll(/(\\*)"/gu, '$1$1\\"').replaceAll(/\\+$/gu, "$&$&")}"`;
}
export function windowsShortcutArguments(args: readonly string[]): string {
  return args.map(windowsArgQuote).join(" ");
}

function runFixed(
  executable: string,
  args: readonly string[],
): { status: number | null; stderr: string } {
  const result = spawnSync(executable, [...args], {
    shell: false,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  return {
    status: result.status,
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function desktopDir(): string {
  return path.join(homedir(), "Desktop");
}

export async function installShortcut(
  platformName: string,
  iconPath: string | null,
  command: ShortcutCommand,
): Promise<string> {
  if (platformName === "linux") {
    const applications = path.join(
      homedir(),
      ".local",
      "share",
      "applications",
    );
    await fs.mkdir(applications, { recursive: true });
    const entry = `[Desktop Entry]
Type=Application
Name=${SHORTCUT_NAME}
Comment=Open the local Aptiloop web UI
Exec=${[command.executable, ...command.args].map(desktopQuote).join(" ")}
Terminal=false
Categories=Education;
${iconPath ? `Icon=${desktopQuote(iconPath)}\n` : ""}
`;
    await fs.writeFile(path.join(applications, "aptiloop.desktop"), entry, {
      flag: "w",
    });
    const desktopFile = path.join(desktopDir(), "aptiloop.desktop");
    try {
      await fs.writeFile(desktopFile, entry, { flag: "wx" });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
    }
    return "Desktop and application shortcuts installed (.desktop, exact runtime target).";
  }
  if (platformName === "darwin") {
    const applications = path.join(homedir(), "Applications");
    await fs.mkdir(applications, { recursive: true });
    const script = `#!/bin/sh\nexec ${[command.executable, ...command.args].map(shellQuote).join(" ")}\n`;
    const launcher = path.join(applications, "Aptiloop.command");
    await fs.writeFile(launcher, script, { flag: "w", mode: 0o755 });
    return "Application shortcut installed (~/Applications/Aptiloop.command, exact runtime target).";
  }
  if (platformName === "win32") {
    const desktopLink = path.join(desktopDir(), "Aptiloop.lnk");
    const startMenu = path.join(
      process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Aptiloop.lnk",
    );
    await fs.mkdir(path.dirname(startMenu), { recursive: true });
    const scriptLines = [
      "$shell = New-Object -ComObject WScript.Shell",
      `$desktop = $shell.CreateShortcut(${powershellQuote(desktopLink)})`,
      `$desktop.TargetPath = ${powershellQuote(command.executable)}`,
      `$desktop.Arguments = ${powershellQuote(windowsShortcutArguments(command.args))}`,
      ...(iconPath
        ? [`$desktop.IconLocation = ${powershellQuote(iconPath)}`]
        : []),
      "$desktop.Save()",
      `$menu = $shell.CreateShortcut(${powershellQuote(startMenu)})`,
      `$menu.TargetPath = ${powershellQuote(command.executable)}`,
      `$menu.Arguments = ${powershellQuote(windowsShortcutArguments(command.args))}`,
      ...(iconPath
        ? [`$menu.IconLocation = ${powershellQuote(iconPath)}`]
        : []),
      "$menu.Save()",
    ];
    const encoded = Buffer.from(scriptLines.join("\r\n"), "utf16le").toString(
      "base64",
    );
    const result = runFixed("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded,
    ]);
    if (result.status !== 0) {
      throw new Error(`Shortcut creation failed: ${result.stderr.trim()}`);
    }
    return "Desktop and Start Menu shortcuts installed (.lnk, exact runtime target).";
  }
  throw new Error(`shortcuts install is not supported on ${platformName}`);
}

export async function removeShortcut(platformName: string): Promise<string> {
  const removeIfPresent = async (file: string): Promise<void> => {
    try {
      await fs.unlink(file);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
  };
  if (platformName === "linux") {
    await removeIfPresent(
      path.join(
        homedir(),
        ".local",
        "share",
        "applications",
        "aptiloop.desktop",
      ),
    );
    await removeIfPresent(path.join(desktopDir(), "aptiloop.desktop"));
    return "Shortcuts removed.";
  }
  if (platformName === "darwin") {
    await removeIfPresent(
      path.join(homedir(), "Applications", "Aptiloop.command"),
    );
    return "Shortcuts removed.";
  }
  if (platformName === "win32") {
    await removeIfPresent(path.join(desktopDir(), "Aptiloop.lnk"));
    await removeIfPresent(
      path.join(
        process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Aptiloop.lnk",
      ),
    );
    return "Shortcuts removed.";
  }
  throw new Error(`shortcuts remove is not supported on ${platformName}`);
}
