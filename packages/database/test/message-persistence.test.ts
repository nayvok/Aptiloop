import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
} from "../src/index.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("LearningRepository message persistence", () => {
  it("cannot persist provider tool payloads or raw events", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aptiloop-message-seam-"));
    const connection = openDatabase(join(directory, "message.sqlite"));
    cleanup.push(() => {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    });
    migrateDatabase(connection);
    let sequence = 0;
    const repository = createLearningRepository(connection, {
      id: () => `message-seam-${++sequence}`,
      now: () => 1_000,
    });
    type AddMessageInput = Parameters<typeof repository.addMessage>[0];
    const inputHasNoProviderPayloadFields: "toolEvents" extends keyof AddMessageInput
      ? false
      : "rawEvent" extends keyof AddMessageInput
        ? false
        : true = true;
    expect(inputHasNoProviderPayloadFields).toBe(true);

    const conversation = await repository.createConversation({
      role: "teacher",
      providerId: "mock",
      modelId: "mock-teacher",
    });
    const unsafeRuntimeObject = {
      conversationId: conversation.id,
      role: "assistant",
      content: "Bounded assistant text",
      toolEvents: [
        {
          input: { secret: "must-not-persist" },
          output: { secret: "must-not-persist" },
        },
      ],
      rawEvent: { protocol: "must-not-persist" },
    };

    await repository.addMessage(unsafeRuntimeObject);

    const stored = connection.sqlite
      .prepare(
        `SELECT tool_events_json, raw_event_json
         FROM agent_messages
         WHERE conversation_id = ?`,
      )
      .get(conversation.id);
    expect(stored).toEqual({
      tool_events_json: "[]",
      raw_event_json: null,
    });
  });
});
