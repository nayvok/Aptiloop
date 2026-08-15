import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  finalizeCoursePack,
  validateCoursePackBytes,
  type CoursePackV1,
} from "@aptiloop/course-authoring-kit";
import { createDevelopmentCoursePackFixture } from "../../course-authoring-kit/test/fixture.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  adaptationBranchIdForRevision,
  applyApprovedM2Migrations,
  coursePackSourceBytesHash,
  CoursePackRepository,
  createApprovedM1Backup,
  createCurriculumAuthoringRepository,
  createLearningKernelRepository,
  createLearningRepository,
  databaseLogicalSha256,
  getCurrentDatabaseMigrationContract,
  migrateDatabase,
  openM1WritableDatabase,
  openDatabase,
  providerConnectionRetirementMigrationContract,
  type DatabaseConnection,
} from "../src/index.js";
import { runM1MigrationCli } from "../src/cli/migrate.js";
import { validateM1WritableDatabasePath } from "../src/cli/path.js";

const encoder = new TextEncoder();
const roots: string[] = [];
const migrationsSource = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("adaptation branch lifecycle", () => {
  it("keeps open-as-draft authoring isolated from the learner-active branch", async () => {
    const projectRoot = temporaryRoot("aptiloop-open-draft-branch-scope-");
    const connection = openDatabase(activeDatabasePath(projectRoot));
    try {
      migrateDatabase(connection);
      const packs = coursePackRepository(connection);
      const firstPack = createDevelopmentCoursePackFixture();
      installPack(packs, firstPack, "install-open-draft-v1", validationId(8));
      const firstBranchId = adaptationBranchIdForRevision(
        firstPack.course.courseKey,
        firstPack.revision.revisionKey,
      );
      const secondPack = nextRevision(firstPack, 2);
      const secondInput = validated(secondPack);
      const opened = packs.install({
        operationId: "open-draft-v2",
        validationId: validationId(9),
        action: "open-as-draft",
        sourceBytesHash: coursePackSourceBytesHash(secondInput.sourceBytes),
        pack: secondInput.validation.pack,
        canonicalJson: secondInput.validation.canonicalJson,
        report: secondInput.validation.report,
      });
      const secondBranchId = adaptationBranchIdForRevision(
        secondPack.course.courseKey,
        secondPack.revision.revisionKey,
      );
      expect(branchRows(connection, firstPack.course.courseKey)).toEqual([
        {
          id: firstBranchId,
          base_revision_id: firstPack.revision.revisionKey,
          head_revision_id: null,
          status: "active",
        },
        {
          id: secondBranchId,
          base_revision_id: secondPack.revision.revisionKey,
          head_revision_id: null,
          status: "archived",
        },
      ]);
      expect(
        await createCurriculumAuthoringRepository(connection).getVersionGraph(
          opened.revisionId,
        ),
      ).toMatchObject({ version: { status: "draft" } });

      const learning = createLearningRepository(connection, {
        now: () => Date.UTC(2026, 7, 13, 11),
        id: (() => {
          let id = 0;
          return () => `open-draft-session-${++id}`;
        })(),
      });
      await learning.selectCourse({
        courseId: firstPack.course.courseKey,
        revisionId: firstPack.revision.revisionKey,
      });
      const firstPath = await createCurriculumAuthoringRepository(
        connection,
      ).getVersionGraph(firstPack.revision.revisionKey);
      const firstDay = firstPath.weeks[0]?.days[0];
      if (!firstDay) throw new Error("Installed v1 lesson is unavailable");
      const session = await learning.startOrResumeVersionedSession({
        dayId: firstDay.id,
        idempotencyKey: "open-draft-v1-session",
      });
      expect(
        connection.sqlite
          .prepare(
            `SELECT revision_id, adaptation_branch_id
             FROM session_course_contexts WHERE session_id = ?`,
          )
          .get(session.session.id),
      ).toEqual({
        revision_id: firstPack.revision.revisionKey,
        adaptation_branch_id: firstBranchId,
      });
      expect(
        createLearningKernelRepository(connection).resolveSessionScope(
          session.session.id,
        ).branchId,
      ).toBe(firstBranchId);
      expect(
        connection.sqlite.prepare("PRAGMA foreign_key_check").all(),
      ).toEqual([]);
    } finally {
      connection.close();
    }
  });

  it("rejects branch rotation during an active session, then preserves completed replay and pins the next session", async () => {
    const projectRoot = temporaryRoot("aptiloop-branch-session-pin-");
    const connection = openDatabase(activeDatabasePath(projectRoot));
    migrateDatabase(connection);
    const packs = coursePackRepository(connection);
    const firstPack = createDevelopmentCoursePackFixture();
    installPack(packs, firstPack, "install-session-v1", validationId(6));
    const learning = createLearningRepository(connection, {
      now: () => Date.UTC(2026, 7, 13, 10),
      id: (() => {
        let id = 0;
        return () => `branch-session-${++id}`;
      })(),
    });
    await learning.selectCourse({
      courseId: firstPack.course.courseKey,
      revisionId: firstPack.revision.revisionKey,
    });
    const firstPath = await createCurriculumAuthoringRepository(
      connection,
    ).getActivePath(firstPack.course.courseKey);
    const firstDay = firstPath?.weeks[0]?.days[0];
    if (!firstDay) throw new Error("Installed v1 lesson is unavailable");
    const firstSession = await learning.startOrResumeVersionedSession({
      dayId: firstDay.id,
      idempotencyKey: "branch-session-v1",
    });
    const kernel = createLearningKernelRepository(connection, {
      now: () => Date.UTC(2026, 7, 13, 10, 0, 1),
    });
    const firstScope = kernel.resolveSessionScope(firstSession.session.id);
    const firstActivity = kernel.listActivities(firstScope)[0];
    if (!firstActivity) throw new Error("Installed v1 activity is unavailable");
    expect(
      kernel.accept(firstScope, {
        operationId: "branch-session-v1-start",
        factId: "branch-session-v1-start-fact",
        observedAt: "2026-08-13T10:00:00.000Z",
        provenance: {
          kind: "learner_submission",
          sourceId: "branch-lifecycle-test",
          sourceHash: `sha256:${"a".repeat(64)}`,
        },
        body: {
          type: "progress",
          activityId: firstActivity.id,
          transition: "start",
        },
      }).accepted,
    ).toBe(true);

    const secondPack = nextRevision(firstPack, 2);
    expect(() =>
      installPack(packs, secondPack, "install-session-v2", validationId(7)),
    ).toThrow(
      "Complete the active Course session before installing another revision",
    );
    expect(branchRows(connection, firstPack.course.courseKey)).toEqual([
      {
        id: firstScope.branchId,
        base_revision_id: firstPack.revision.revisionKey,
        head_revision_id: null,
        status: "active",
      },
    ]);
    expect(
      connection.sqlite
        .prepare(`SELECT active_revision_id FROM courses WHERE id = ?`)
        .get(firstPack.course.courseKey),
    ).toEqual({ active_revision_id: firstPack.revision.revisionKey });

    await learning.completeSession({ sessionId: firstSession.session.id });
    installPack(packs, secondPack, "install-session-v2", validationId(7));
    const secondBranchId = adaptationBranchIdForRevision(
      secondPack.course.courseKey,
      secondPack.revision.revisionKey,
    );
    expect(kernel.resolveSessionScope(firstSession.session.id)).toEqual(
      firstScope,
    );
    expect(
      kernel.reproject(firstScope, "2026-08-13T10:01:00.000Z").factFrontier,
    ).toEqual(["branch-session-v1-start-fact"]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT active_revision_id, current_learning_session_id
           FROM learner_course_states WHERE course_id = ?`,
        )
        .get(firstPack.course.courseKey),
    ).toEqual({
      active_revision_id: secondPack.revision.revisionKey,
      current_learning_session_id: null,
    });

    const secondPath = await createCurriculumAuthoringRepository(
      connection,
    ).getActivePath(firstPack.course.courseKey);
    const secondDay = secondPath?.weeks[0]?.days[0];
    if (!secondDay) throw new Error("Installed v2 lesson is unavailable");
    const secondSession = await learning.startOrResumeVersionedSession({
      dayId: secondDay.id,
      idempotencyKey: "branch-session-v2",
    });
    expect(kernel.resolveSessionScope(secondSession.session.id).branchId).toBe(
      secondBranchId,
    );
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
    connection.close();
  });

  it("retains the archived v1 branch and opens a distinct active v2 branch after reopen", () => {
    const projectRoot = temporaryRoot("aptiloop-branch-reinstall-");
    const databasePath = activeDatabasePath(projectRoot);
    const connection = openDatabase(databasePath);
    migrateDatabase(connection);
    const repository = coursePackRepository(connection);
    const firstPack = createDevelopmentCoursePackFixture();
    installPack(repository, firstPack, "install-v1", validationId(1));
    const firstBranchId = adaptationBranchIdForRevision(
      firstPack.course.courseKey,
      firstPack.revision.revisionKey,
    );

    repository.uninstall({
      operationId: "uninstall-v1",
      revisionId: firstPack.revision.revisionKey,
      confirmRevisionKey: firstPack.revision.revisionKey,
    });
    const secondPack = nextRevision(firstPack, 2);
    installPack(repository, secondPack, "install-v2", validationId(2));
    const secondBranchId = adaptationBranchIdForRevision(
      secondPack.course.courseKey,
      secondPack.revision.revisionKey,
    );

    expect(secondBranchId).not.toBe(firstBranchId);
    expect(branchRows(connection, firstPack.course.courseKey)).toEqual([
      {
        id: firstBranchId,
        base_revision_id: firstPack.revision.revisionKey,
        head_revision_id: null,
        status: "archived",
      },
      {
        id: secondBranchId,
        base_revision_id: secondPack.revision.revisionKey,
        head_revision_id: null,
        status: "active",
      },
    ]);
    expect(
      connection.sqlite
        .prepare(`SELECT active_revision_id FROM courses WHERE id = ?`)
        .get(firstPack.course.courseKey),
    ).toEqual({ active_revision_id: secondPack.revision.revisionKey });
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
    connection.close();

    const reopened = openM1WritableDatabase(databasePath, {
      revalidateTarget: () =>
        validateM1WritableDatabasePath(databasePath, { projectRoot }),
    });
    try {
      expect(reopened.migrationAdmission?.kind).toBe("current");
      expect(branchRows(reopened, firstPack.course.courseKey)).toEqual([
        {
          id: firstBranchId,
          base_revision_id: firstPack.revision.revisionKey,
          head_revision_id: null,
          status: "archived",
        },
        {
          id: secondBranchId,
          base_revision_id: secondPack.revision.revisionKey,
          head_revision_id: null,
          status: "active",
        },
      ]);
      expect(() =>
        reopened.sqlite
          .prepare(
            `UPDATE adaptation_branches SET status = 'active'
             WHERE course_id = ? AND id = ?`,
          )
          .run(firstPack.course.courseKey, firstBranchId),
      ).toThrow(/UNIQUE constraint/u);
      expect(() =>
        reopened.sqlite
          .prepare(
            `UPDATE adaptation_branches SET head_revision_id = ?
             WHERE course_id = ? AND id = ?`,
          )
          .run(
            secondPack.revision.revisionKey,
            firstPack.course.courseKey,
            firstBranchId,
          ),
      ).toThrow(/adaptation branch revision scope is invalid/u);
    } finally {
      reopened.close();
    }
  });

  it("migrates exact 0019 with an approved backup without rewriting branch identity", async () => {
    const fixture = await preLifecycleFixture();
    const before = openDatabase(fixture.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const beforeRows = branchRows(before, fixture.courseId);
    before.close();

    expect(
      runM1MigrationCli({
        projectRoot: fixture.projectRoot,
        argv: migrationArguments(fixture),
        writeStatus: () => undefined,
      }),
    ).toContain("migrated with verified recovery backup");
    expect(fileSha256(fixture.backupPath)).toBe(fixture.backupSha256);

    const reopened = openM1WritableDatabase(fixture.databasePath, {
      revalidateTarget: () =>
        validateM1WritableDatabasePath(fixture.databasePath, {
          projectRoot: fixture.projectRoot,
        }),
    });
    try {
      expect(reopened.migrationAdmission?.kind).toBe("current");
      expect(branchRows(reopened, fixture.courseId)).toEqual(beforeRows);
      expect(
        reopened.sqlite
          .prepare("SELECT id FROM __dlh_migrations ORDER BY id DESC LIMIT 1")
          .get(),
      ).toEqual({ id: "0020_adaptation_branch_lifecycle" });
      expect(reopened.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      reopened.close();
    }
  });

  it("binds an imported personal revision to its upstream base and accepted branch head", () => {
    const projectRoot = temporaryRoot("aptiloop-personal-pack-branch-");
    const connection = openDatabase(activeDatabasePath(projectRoot));
    migrateDatabase(connection);
    const repository = coursePackRepository(connection);
    const upstream = createDevelopmentCoursePackFixture();
    installPack(repository, upstream, "install-personal-base", validationId(4));
    const personal = nextRevision(upstream, 2);
    personal.revision.branchKind = "personal";
    personal.revision.basedOnContentHash = upstream.revision.contentHash;
    const finalizedPersonal = finalizeCoursePack(personal);

    installPack(
      repository,
      finalizedPersonal,
      "install-personal-head",
      validationId(5),
    );
    const branchId = adaptationBranchIdForRevision(
      personal.course.courseKey,
      personal.revision.revisionKey,
    );
    expect(branchRows(connection, personal.course.courseKey)).toContainEqual({
      id: branchId,
      base_revision_id: upstream.revision.revisionKey,
      head_revision_id: personal.revision.revisionKey,
      status: "active",
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT adaptation_branch_id FROM curriculum_versions WHERE id = ?`,
        )
        .get(personal.revision.revisionKey),
    ).toEqual({ adaptation_branch_id: branchId });

    repository.uninstall({
      operationId: "uninstall-personal-head",
      revisionId: personal.revision.revisionKey,
      confirmRevisionKey: personal.revision.revisionKey,
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT status FROM adaptation_branches
           WHERE course_id = ? AND id = ?`,
        )
        .get(personal.course.courseKey, branchId),
    ).toEqual({ status: "archived" });
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
    connection.close();
  });

  it("rolls back 0020 and retains ambiguous 0019 rows for explicit recovery", async () => {
    const fixture = await preLifecycleFixture({ ambiguous: true });
    const beforeHash = fileSha256(fixture.backupPath);

    const admitted = openM1WritableDatabase(fixture.databasePath, {
      revalidateTarget: () =>
        validateM1WritableDatabasePath(fixture.databasePath, {
          projectRoot: fixture.projectRoot,
        }),
    });
    try {
      expect(admitted.migrationAdmission?.kind).toBe("legacy-compatible");
    } finally {
      admitted.close();
    }
    expect(fileSha256(fixture.backupPath)).toBe(beforeHash);

    const unchanged = openDatabase(fixture.databasePath);
    try {
      const logicalSha256 = databaseLogicalSha256(unchanged.sqlite);
      expect(() =>
        applyApprovedM2Migrations(
          unchanged,
          {
            kind: "approved-backup-m2",
            sourceContract: providerConnectionRetirementMigrationContract,
            sourceLogicalSha256: logicalSha256,
            targetContract: getCurrentDatabaseMigrationContract(),
            approvedBackupLogicalSha256: logicalSha256,
            approvedBackupSha256: "a".repeat(64),
            approvedBackupPathHash: "b".repeat(64),
          },
          { assertBackupUnchangedBeforeCommit: () => undefined },
        ),
      ).toThrow(/adaptation_branch_lifecycle_preflight/u);
      expect(
        unchanged.sqlite
          .prepare("SELECT id FROM __dlh_migrations ORDER BY id DESC LIMIT 1")
          .get(),
      ).toEqual({ id: "0019_provider_connection_retirement" });
      expect(
        unchanged.sqlite
          .prepare(
            `SELECT count(*) AS count FROM adaptation_branches
             WHERE course_id = ? AND status = 'active'`,
          )
          .get(fixture.courseId),
      ).toEqual({ count: 2 });
      expect(
        unchanged.sqlite
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE name = 'adaptation_branches_one_active_course_uq'`,
          )
          .get(),
      ).toBeUndefined();
    } finally {
      unchanged.close();
    }
  });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  mkdirSync(path.join(root, ".data"), { recursive: true });
  return root;
}

function activeDatabasePath(projectRoot: string): string {
  return path.join(projectRoot, ".data", "dev-learning-harness.sqlite");
}

function validated(pack: CoursePackV1) {
  const finalized = finalizeCoursePack(pack);
  const sourceBytes = encoder.encode(JSON.stringify(finalized, null, 2));
  const validation = validateCoursePackBytes(sourceBytes);
  if (!validation.valid) throw new Error(JSON.stringify(validation.report));
  return { sourceBytes, validation };
}

function installPack(
  repository: CoursePackRepository,
  pack: CoursePackV1,
  operationId: string,
  validationIdValue: string,
): void {
  const input = validated(pack);
  repository.install({
    operationId,
    validationId: validationIdValue,
    action: "install",
    sourceBytesHash: coursePackSourceBytesHash(input.sourceBytes),
    pack: input.validation.pack,
    canonicalJson: input.validation.canonicalJson,
    report: input.validation.report,
  });
}

function coursePackRepository(connection: DatabaseConnection) {
  let id = 0;
  return new CoursePackRepository(connection, {
    now: () => Date.UTC(2026, 7, 13) + id,
    id: () => `adaptation-lifecycle-event-${++id}`,
  });
}

function nextRevision(
  pack: CoursePackV1,
  revisionNumber: number,
): CoursePackV1 {
  const next = structuredClone(pack);
  next.revision.revisionKey = `${pack.course.courseKey}/v${revisionNumber}`;
  next.revision.revisionNumber = revisionNumber;
  next.revision.parentRevisionKey = pack.revision.revisionKey;
  return finalizeCoursePack(next);
}

function validationId(index: number): string {
  return `77777777-7777-4777-8777-77777777777${index}`;
}

function branchRows(connection: DatabaseConnection, courseId: string) {
  return connection.sqlite
    .prepare(
      `SELECT id, base_revision_id, head_revision_id, status
       FROM adaptation_branches
       WHERE course_id = ?
       ORDER BY created_at, id`,
    )
    .all(courseId);
}

async function preLifecycleFixture(
  options: { ambiguous?: boolean } = {},
): Promise<{
  projectRoot: string;
  databasePath: string;
  backupPath: string;
  backupSha256: string;
  courseId: string;
}> {
  const projectRoot = temporaryRoot("aptiloop-pre-branch-lifecycle-");
  const migrationDirectory = path.join(projectRoot, "migrations-through-0019");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^(?:000\d|001\d)_.*\.sql$/u.test(entry),
  )) {
    copyFileSync(
      path.join(migrationsSource, filename),
      path.join(migrationDirectory, filename),
    );
  }
  const databasePath = activeDatabasePath(projectRoot);
  const connection = openDatabase(databasePath);
  const pack = createDevelopmentCoursePackFixture();
  try {
    migrateDatabase(connection, migrationDirectory);
    installPack(
      coursePackRepository(connection),
      pack,
      "install-pre-lifecycle",
      validationId(3),
    );
  } finally {
    connection.close();
  }
  const backupPath = path.join(
    projectRoot,
    ".data",
    "approved-backups",
    "approved-pre-branch-lifecycle.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot,
    sourcePath: databasePath,
    destinationPath: backupPath,
  });
  if (options.ambiguous) {
    const ambiguous = openDatabase(databasePath);
    try {
      ambiguous.sqlite
        .prepare(
          `INSERT INTO adaptation_branches
           (id, course_id, owner, base_revision_id, head_revision_id, status,
            created_at, updated_at)
           VALUES ('ambiguous-active-branch', ?, 'local', ?, NULL, 'active',
                   1, 1)`,
        )
        .run(pack.course.courseKey, pack.revision.revisionKey);
    } finally {
      ambiguous.close();
    }
  }
  return {
    projectRoot,
    databasePath,
    backupPath,
    backupSha256: fileSha256(backupPath),
    courseId: pack.course.courseKey,
  };
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function migrationArguments(fixture: {
  backupPath: string;
  backupSha256: string;
}): string[] {
  return [
    "--authorize-current",
    "--approved-backup",
    fixture.backupPath,
    "--backup-sha256",
    fixture.backupSha256,
  ];
}
