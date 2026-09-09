import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";

import { COURSE_PACK_VALIDATOR_VERSION } from "@aptiloop/course-authoring-kit";
import { getCurrentDatabaseMigrationContract } from "@aptiloop/database";
import {
  buildAptiloopStartCommand,
  installShortcut,
  queryAutostart,
  removeShortcut,
  setAutostart,
} from "@aptiloop/os-service";
import type { Hono } from "hono";
import { z } from "zod";
import { createUpdateManager, type UpdateManager } from "./update-manager.js";

export const UPDATE_CHANNEL = "github-releases" as const;

const deploymentProfileSchema = z.enum([
  "source-checkout",
  "installed-release",
  "compose",
]);
export type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;

export interface SystemRouteOptions {
  readonly projectRoot: string;
  readonly webOrigin: string;
  readonly orchestratorPort: number;
  readonly databasePath: string;
  readonly deploymentProfile?: string;
  readonly installedRelease?: boolean;
  readonly bindMode?: string;
  readonly platformName?: string;
  readonly updateManager?: UpdateManager;
}

const operationIdSchema = z.string().uuid();
const autostartMutationSchema = z
  .object({
    operationId: operationIdSchema,
    autostart: z.boolean(),
  })
  .strict();
const shortcutsMutationSchema = z
  .object({
    operationId: operationIdSchema,
    action: z.enum(["install", "remove"]),
  })
  .strict();

export function resolveDeploymentProfile(
  configured: string | undefined,
  bindMode: string | undefined,
  installedRelease = false,
): DeploymentProfile {
  if (configured !== undefined) {
    return deploymentProfileSchema.parse(configured);
  }
  if (installedRelease) return "installed-release";
  return bindMode === "container-loopback-published"
    ? "compose"
    : "source-checkout";
}

export function readAppVersion(
  projectRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnvironment = environment.APTILOOP_APP_VERSION?.trim();
  if (fromEnvironment) return fromEnvironment;
  for (const manifestName of ["package.json", "version-manifest.json"]) {
    try {
      const raw = readFileSync(path.join(projectRoot, manifestName), "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim() !== "") {
        return parsed.version;
      }
    } catch {
      // Try the next installed-runtime manifest.
    }
  }
  return "0.0.0-dev";
}

let cachedMigrationHead: string | null = null;

export function readMigrationLedgerHead(): string {
  if (cachedMigrationHead !== null) return cachedMigrationHead;
  try {
    const contract = getCurrentDatabaseMigrationContract();
    const head = contract.migrationIds[contract.migrationIds.length - 1];
    cachedMigrationHead = typeof head === "string" ? head : "unknown";
  } catch {
    cachedMigrationHead = "unknown";
  }
  return cachedMigrationHead;
}

function webPortFromOrigin(webOrigin: string): number | null {
  try {
    const port = Number(new URL(webOrigin).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}
function stableCliEntry(projectRoot: string): string {
  const explicit = process.env.APTILOOP_BOOTSTRAP_ENTRY?.trim();
  if (explicit) return path.resolve(explicit);
  const releaseRoot = process.env.APTILOOP_RELEASE_ROOT?.trim();
  if (releaseRoot) {
    const runtimeLauncher = process.env.APTILOOP_RUNTIME_LAUNCHER?.trim();
    if (runtimeLauncher) return path.resolve(runtimeLauncher);
    throw new Error(
      "Installed runtime is missing APTILOOP_BOOTSTRAP_ENTRY/APTILOOP_RUNTIME_LAUNCHER.",
    );
  }
  return path.join(projectRoot, "packages", "cli", "dist", "bootstrap.cjs");
}

export function registerSystemRoutes(
  app: Hono,
  options: SystemRouteOptions,
): void {
  const platformName = options.platformName ?? platform();
  const profile = resolveDeploymentProfile(
    options.deploymentProfile,
    options.bindMode,
    options.installedRelease ?? false,
  );
  const dataDir =
    options.databasePath === ":memory:"
      ? null
      : path.dirname(options.databasePath);
  const updateManager =
    options.updateManager ??
    createUpdateManager({
      dataDir: dataDir ?? path.join(options.projectRoot, ".data"),
      ...(options.databasePath === undefined
        ? {}
        : { databasePath: options.databasePath }),
      stableCliEntry:
        process.env.APTILOOP_BOOTSTRAP_ENTRY?.trim() ??
        process.env.APTILOOP_RUNTIME_LAUNCHER?.trim() ??
        path.join(
          options.projectRoot,
          "packages",
          "cli",
          "dist",
          "bootstrap.cjs",
        ),
      detachedWorkerEntry:
        process.env.APTILOOP_UPDATE_WORKER?.trim() ??
        path.join(options.projectRoot, "scripts", "update-worker.mjs"),
      currentVersion: readAppVersion(options.projectRoot),
      ...(process.env.APTILOOP_RUNTIME_ROOT?.trim()
        ? { runtimeRoot: process.env.APTILOOP_RUNTIME_ROOT.trim() }
        : {}),
    });

  app.get("/api/version", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({
      product: "Aptiloop",
      appVersion: readAppVersion(options.projectRoot),
      validatorVersion: COURSE_PACK_VALIDATOR_VERSION,
      migrationHead: readMigrationLedgerHead(),
      channel: UPDATE_CHANNEL,
      deploymentProfile: profile,
      webOrigin: options.webOrigin,
    });
  });
  app.get("/api/system/update/check", async (context) => {
    try {
      return context.json(await updateManager.check());
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        503,
      );
    }
  });
  app.post("/api/system/update/apply", async (context) => {
    if (profile === "compose") {
      return context.json(
        {
          error:
            "Compose updates are image-owned. Pull the reviewed image and restart with the paired data volume; local apply is disabled.",
        },
        409,
      );
    }
    if (profile === "source-checkout") {
      return context.json(
        {
          error:
            'Source-checkout updates are disabled: an installed release is required. Install the reviewed npm package with "npm install --global aptiloop@<version>" (or the reviewed runtime bundle), then run "aptiloop init" and restart the service; no git pull is performed.',
        },
        409,
      );
    }
    if (options.databasePath === ":memory:") {
      return context.json(
        {
          error:
            "Updates require a file-backed database; no runtime or database changes were made.",
        },
        409,
      );
    }
    try {
      const body = z
        .object({ operationId: operationIdSchema, tag: z.string() })
        .strict()
        .parse(await context.req.json());
      return context.json(
        await updateManager.apply(body.tag, body.operationId),
        202,
      );
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });
  app.get("/api/system/update/operations/:id", async (context) => {
    const operation = await updateManager.operation(context.req.param("id"));
    return operation
      ? context.json(operation)
      : context.json({ error: "Update operation not found." }, 404);
  });

  app.get("/api/system/runtime", (context) => {
    context.header("Cache-Control", "no-store");
    const webPort = webPortFromOrigin(options.webOrigin);
    return context.json({
      webOrigin: options.webOrigin,
      ...(webPort === null ? {} : { webPort }),
      orchestratorPort: options.orchestratorPort,
      dataDir,
      deploymentProfile: profile,
      channel: UPDATE_CHANNEL,
      autostartSupported: profile !== "compose",
      shortcutsSupported: profile !== "compose",
    });
  });

  app.get("/api/system/autostart", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const state = await queryAutostart(platformName);
      return context.json(state);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });

  app.post("/api/system/autostart", async (context) => {
    const body = autostartMutationSchema.parse(await context.req.json());
    if (profile === "compose") {
      return context.json(
        {
          error:
            "Autostart is unavailable in the compose profile: the container has no host OS service to manage. Use the host CLI instead.",
        },
        409,
      );
    }
    if (dataDir === null) {
      return context.json(
        { error: "Autostart requires a file-backed database." },
        409,
      );
    }
    const cliEntry = stableCliEntry(options.projectRoot);
    if (!existsSync(cliEntry)) {
      return context.json(
        {
          error:
            "The stable Aptiloop launcher is not installed. Reinstall the npm package or runtime bundle, then retry.",
        },
        409,
      );
    }
    const webPort = webPortFromOrigin(options.webOrigin);
    if (webPort === null) {
      return context.json({ error: "The web origin has no usable port." }, 500);
    }
    try {
      const start = buildAptiloopStartCommand(cliEntry, {
        webPort,
        orchestratorPort: options.orchestratorPort,
        dataDir,
        webLog: path.join(dataDir, "runtime", "web.log"),
        orchestratorLog: path.join(dataDir, "runtime", "orchestrator.log"),
      });
      const result = await setAutostart(
        {
          webPort,
          orchestratorPort: options.orchestratorPort,
          dataDir,
          webLog: path.join(dataDir, "runtime", "web.log"),
          orchestratorLog: path.join(dataDir, "runtime", "orchestrator.log"),
        },
        platformName,
        body.autostart,
        start,
      );
      const state = await queryAutostart(platformName);
      return context.json({ ...state, message: result.message });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });

  app.post("/api/system/shortcuts", async (context) => {
    const body = shortcutsMutationSchema.parse(await context.req.json());
    if (profile === "compose") {
      return context.json(
        {
          error:
            "Shortcuts are unavailable in the compose profile: the container cannot install host shortcuts. Use the host CLI instead.",
        },
        409,
      );
    }
    try {
      const releaseRoot = process.env.APTILOOP_RELEASE_ROOT?.trim();
      const iconCandidate = releaseRoot
        ? path.join(
            releaseRoot,
            "apps",
            "web",
            ".next",
            "standalone",
            "apps",
            "web",
            "app",
            "icon.svg",
          )
        : path.join(options.projectRoot, "apps", "web", "app", "icon.svg");
      const cliEntry = stableCliEntry(options.projectRoot);
      const message =
        body.action === "install"
          ? await installShortcut(
              platformName,
              existsSync(iconCandidate) ? iconCandidate : null,
              { executable: process.execPath, args: [cliEntry, "open"] },
            )
          : await removeShortcut(platformName);
      return context.json({ message });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });
}
