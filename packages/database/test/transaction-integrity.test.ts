import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openDatabase,
  withTransaction,
  type DatabaseConnection,
} from "../src/database.js";

function fixture(): DatabaseConnection {
  const connection = openDatabase(":memory:");
  connection.sqlite.exec(
    "CREATE TABLE transaction_events (value TEXT PRIMARY KEY NOT NULL)",
  );
  return connection;
}

describe("database transaction integrity", () => {
  it("rejects a Promise result and rolls back before the callback can resume", async () => {
    const connection = fixture();
    let resume: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let invoked = false;

    try {
      expect(() =>
        withTransaction(connection, (async () => {
          invoked = true;
          connection.sqlite
            .prepare("INSERT INTO transaction_events (value) VALUES (?)")
            .run("must-roll-back");
          await gate;
        }) as never),
      ).toThrow("Database transaction callbacks must be synchronous");
      expect(connection.sqlite.isTransaction).toBe(false);
      expect(
        connection.sqlite.prepare("SELECT value FROM transaction_events").all(),
      ).toEqual([]);
      expect(invoked).toBe(false);

      resume?.();
      await gate;
      await Promise.resolve();
      expect(invoked).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("fail-stops the connection when an invoked callback disguises a Promise", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aptiloop-transaction-stop-"));
    const databasePath = join(directory, "transaction.sqlite");
    const connection = openDatabase(databasePath);
    connection.sqlite.exec(
      "CREATE TABLE transaction_events (value TEXT PRIMARY KEY NOT NULL)",
    );
    let resume: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let continuationError: unknown;

    expect(() =>
      withTransaction(connection, (() =>
        (async () => {
          connection.sqlite
            .prepare("INSERT INTO transaction_events (value) VALUES (?)")
            .run("must-roll-back");
          await gate;
          try {
            connection.sqlite
              .prepare("INSERT INTO transaction_events (value) VALUES (?)")
              .run("must-not-escape");
          } catch (error) {
            continuationError = error;
            throw error;
          }
        })()) as never),
    ).toThrow("Database transaction callbacks must be synchronous");
    expect(() =>
      connection.sqlite.prepare("SELECT value FROM transaction_events").all(),
    ).toThrow();
    expect(() => withTransaction(connection, () => undefined)).toThrow(
      "Database connection is closed",
    );

    resume?.();
    await gate;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(continuationError).toBeInstanceOf(Error);

    const verifier = openDatabase(databasePath);
    try {
      expect(
        verifier.sqlite.prepare("SELECT value FROM transaction_events").all(),
      ).toEqual([]);
    } finally {
      verifier.close();
      // Poisoned connections close idempotently during ordinary cleanup.
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("commits nested synchronous transactions through savepoints", () => {
    const connection = fixture();

    try {
      const result = withTransaction(connection, () => {
        connection.sqlite
          .prepare("INSERT INTO transaction_events (value) VALUES (?)")
          .run("outer");
        const nested = withTransaction(connection, () => {
          connection.sqlite
            .prepare("INSERT INTO transaction_events (value) VALUES (?)")
            .run("nested");
          return "nested-result";
        });
        expect(nested).toBe("nested-result");
        return "outer-result";
      });

      expect(result).toBe("outer-result");
      expect(
        connection.sqlite
          .prepare("SELECT value FROM transaction_events ORDER BY value")
          .all(),
      ).toEqual([{ value: "nested" }, { value: "outer" }]);
    } finally {
      connection.close();
    }
  });

  it("rolls back only the failed nested synchronous savepoint", () => {
    const connection = fixture();

    try {
      withTransaction(connection, () => {
        connection.sqlite
          .prepare("INSERT INTO transaction_events (value) VALUES (?)")
          .run("outer");
        expect(() =>
          withTransaction(connection, () => {
            connection.sqlite
              .prepare("INSERT INTO transaction_events (value) VALUES (?)")
              .run("nested-rolled-back");
            throw new Error("nested failure");
          }),
        ).toThrow("nested failure");
      });

      expect(
        connection.sqlite
          .prepare("SELECT value FROM transaction_events ORDER BY value")
          .all(),
      ).toEqual([{ value: "outer" }]);
    } finally {
      connection.close();
    }
  });
});
