import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProductionBuildPlan,
  createProductionServicePlans,
  launchProcessGroup,
} from "./local-process-launcher.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const build = createProductionBuildPlan(projectRoot);
const buildResult = spawnSync(
  process.execPath,
  [build.entry, ...build.args],
  build.options,
);
if (buildResult.error) throw buildResult.error;
if (buildResult.status !== 0) {
  throw new Error(
    `Production build failed with ${buildResult.signal ? `signal ${buildResult.signal}` : `exit code ${buildResult.status ?? 1}`}.`,
  );
}
const plans = createProductionServicePlans(projectRoot);

for (const plan of plans) {
  try {
    accessSync(plan.entry, constants.R_OK);
  } catch {
    throw new Error(
      `Production build is missing ${plan.entry}. Run npm run build first.`,
    );
  }
}

const application = launchProcessGroup(plans);
process.once("SIGINT", () => application.stop(0));
process.once("SIGTERM", () => application.stop(0));
