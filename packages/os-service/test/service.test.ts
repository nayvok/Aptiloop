import { describe, expect, it } from "vitest";

import {
  buildAptiloopStartCommand,
  parseScheduledTaskXmlEnabled,
  setLogonTriggerEnabled,
} from "../src/service.js";
import { windowsShortcutArguments } from "../src/shortcuts.js";

describe("buildAptiloopStartCommand", () => {
  it("uses the stable launcher with persisted service data", () => {
    const command = buildAptiloopStartCommand("/opt/aptiloop/launcher.cjs", {
      webPort: 10101,
      orchestratorPort: 8787,
      dataDir: "/data/aptiloop",
      webLog: "/data/aptiloop/runtime/web.log",
      orchestratorLog: "/data/aptiloop/runtime/orchestrator.log",
    });
    expect(command.args).toEqual([
      "/opt/aptiloop/launcher.cjs",
      "start",
      "--service-run",
      "--data-dir",
      "/data/aptiloop",
    ]);
  });
});

describe("windowsShortcutArguments", () => {
  it("quotes stable launcher arguments using Windows command-line rules", () => {
    expect(
      windowsShortcutArguments([
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Users\\Yan\\Aptiloop\\bootstrap.cjs",
        "open",
      ]),
    ).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\Yan\\Aptiloop\\bootstrap.cjs open',
    );
  });
});

describe("parseScheduledTaskXmlEnabled", () => {
  it("reads the logon trigger state rather than task global state", () => {
    expect(
      parseScheduledTaskXmlEnabled(
        "<Enabled>true</Enabled><Triggers><LogonTrigger><Enabled>false</Enabled></LogonTrigger></Triggers>",
      ),
    ).toBe(false);
    expect(
      parseScheduledTaskXmlEnabled(
        "<Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>",
      ),
    ).toBe(true);
  });
});

describe("setLogonTriggerEnabled", () => {
  it("changes only the single logon trigger and rejects ambiguous XML", () => {
    const xml =
      "<Task><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Settings><Enabled>true</Enabled></Settings></Task>";
    expect(setLogonTriggerEnabled(xml, false)).toContain(
      "<LogonTrigger><Enabled>false</Enabled>",
    );
    expect(setLogonTriggerEnabled(xml, true)).toContain(
      "<LogonTrigger><Enabled>true</Enabled>",
    );
    expect(() =>
      setLogonTriggerEnabled(
        "<Task><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Settings><Enabled>true</Enabled></Settings></Task>",
        false,
      ),
    ).toThrow();
  });
});
