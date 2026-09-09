import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

export const SHARE_FORMAT = "aptiloop.course-pack";
export const TRANSFER_FORMAT = "aptiloop.course-transfer-v1";

interface CoursePackListItem {
  readonly courseId?: unknown;
  readonly revisionId?: unknown;
  readonly courseKey?: unknown;
  readonly revisionNumber?: unknown;
}

export async function listCourses(orchestratorUrl: string): Promise<string> {
  const response = await fetch(`${orchestratorUrl}/api/course-packs`, {
    headers: { "X-Aptiloop-Client": "web" },
  });
  if (!response.ok) {
    throw new Error(`Course list failed with status ${response.status}.`);
  }
  const body = (await response.json()) as {
    packs?: CoursePackListItem[];
    storageAvailable?: boolean;
  };
  const packs = Array.isArray(body.packs) ? body.packs : [];
  if (packs.length === 0) {
    return "No local Courses yet. Create one locally or import a Course Pack file.";
  }
  return packs
    .map(
      (pack) =>
        `- course ${String(pack.courseId ?? "?")} revision ${String(pack.revisionId ?? "?")} (key ${String(pack.courseKey ?? "?")} #${String(pack.revisionNumber ?? "?")})`,
    )
    .join("\n");
}

export async function exportCourse(options: {
  orchestratorUrl: string;
  courseKey?: string | undefined;
  revisionId?: string | undefined;
  withProgress: boolean;
  scopeNote?: string | undefined;
  outPath: string;
}): Promise<string> {
  if (options.withProgress && !options.courseKey) {
    throw new Error(
      "Transfer export requires --course <key> (stable course key, repeatable for up to 32 courses) plus --scope-note.",
    );
  }
  if (!options.courseKey && !options.revisionId) {
    throw new Error(
      "courses export requires --course <key> or --revision <id>.",
    );
  }
  if (options.withProgress) {
    const body = JSON.stringify({
      operationId: randomUUID(),
      courseKeys: [options.courseKey as string],
      includeHistory: true,
      scopeNote: options.scopeNote ?? "aptiloop CLI transfer export",
    });
    const response = await fetch(
      `${options.orchestratorUrl}/api/course-transfer/export`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Aptiloop-Client": "web",
        },
        body,
      },
    );
    if (response.status === 404) {
      throw new Error(
        "Transfer export is unavailable on this build (course-transfer routes not present).",
      );
    }
    if (!response.ok) {
      throw new Error(`Transfer export failed with status ${response.status}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(options.outPath, buffer);
    return `Transfer envelope written to ${options.outPath} (${buffer.length} bytes).`;
  }
  if (!options.revisionId) {
    throw new Error(
      "Share export needs a revision id. Use --revision <id> (see courses list) or --with-progress for a key-based transfer.",
    );
  }
  const response = await fetch(
    `${options.orchestratorUrl}/api/course-packs/export?revisionId=${encodeURIComponent(options.revisionId)}`,
    { headers: { "X-Aptiloop-Client": "web" } },
  );
  if (!response.ok) {
    throw new Error(`Share export failed with status ${response.status}.`);
  }
  const text = await response.text();
  await fs.writeFile(options.outPath, text.endsWith("\n") ? text : `${text}\n`);
  return `Share pack written to ${options.outPath}.`;
}

export async function importCourse(options: {
  orchestratorUrl: string;
  filePath: string;
  dryRun: boolean;
}): Promise<string> {
  const raw = await fs.readFile(options.filePath, "utf8");
  let format: string | null;
  try {
    const parsed = JSON.parse(raw) as { format?: unknown };
    format = typeof parsed.format === "string" ? parsed.format : null;
  } catch {
    throw new Error("Import file is not valid JSON.");
  }
  const isTransfer = format === TRANSFER_FORMAT;
  if (format !== SHARE_FORMAT && !isTransfer) {
    throw new Error(
      `Unknown file format ${format === null ? "(missing format field)" : JSON.stringify(format)}: not a share pack or transfer envelope. Nothing was imported.`,
    );
  }
  const validatePath = isTransfer
    ? "/api/course-transfer/validate"
    : "/api/course-packs/validate";
  const validateResponse = await fetch(
    `${options.orchestratorUrl}${validatePath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aptiloop-Client": "web",
      },
      body: raw,
    },
  );
  if (validateResponse.status === 404 && isTransfer) {
    throw new Error(
      "Transfer import is unavailable on this build (course-transfer routes not present).",
    );
  }
  const report = (await validateResponse.json()) as {
    valid?: boolean;
    error?: string;
    validationId?: string;
    preview?: { contentHash?: string };
  };
  if (!validateResponse.ok || report.valid !== true) {
    throw new Error(
      `Validation failed: ${typeof report.error === "string" ? report.error : `status ${validateResponse.status}`}. Nothing was imported.`,
    );
  }
  if (options.dryRun || !report.validationId) {
    return `Validation passed${report.validationId ? ` (validation ${report.validationId})` : ""}. Dry run: nothing was installed.`;
  }
  const commitPath = isTransfer
    ? `/api/course-transfer/validations/${encodeURIComponent(report.validationId)}/commit`
    : `/api/course-packs/validations/${encodeURIComponent(report.validationId)}/commit`;
  const commitResponse = await fetch(
    `${options.orchestratorUrl}${commitPath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aptiloop-Client": "web",
      },
      body: JSON.stringify({
        operationId: randomUUID(),
        action: "install",
        ...(report.preview?.contentHash
          ? { expectedContentHash: report.preview.contentHash }
          : {}),
      }),
    },
  );
  const result = (await commitResponse.json()) as { error?: string };
  if (!commitResponse.ok) {
    throw new Error(
      `Import commit failed: ${typeof result.error === "string" ? result.error : `status ${commitResponse.status}`}.`,
    );
  }
  return `Import committed (validation ${report.validationId}).`;
}
