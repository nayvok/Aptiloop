import { describe, expect, it } from "vitest";

import {
  isTutorMessageKeyForUnit,
  parseTutorTurnMessageKey,
  tutorTurnMessageKey,
  tutorUnitMessagePrefix,
} from "../src/tutor-message-scope.js";

describe("Tutor message scope", () => {
  it("keeps colon-related unit IDs collision-free and parseable", () => {
    const topicKey = tutorTurnMessageKey("topic", "turn-1", "user");
    const advancedKey = tutorTurnMessageKey("topic:advanced", "turn-1", "user");

    expect(topicKey).not.toBe(advancedKey);
    expect(advancedKey.startsWith(tutorUnitMessagePrefix("topic"))).toBe(false);
    expect(topicKey.startsWith(tutorUnitMessagePrefix("topic:advanced"))).toBe(
      false,
    );
    expect(isTutorMessageKeyForUnit(topicKey, "topic")).toBe(true);
    expect(isTutorMessageKeyForUnit(topicKey, "topic:advanced")).toBe(false);
    expect(parseTutorTurnMessageKey(advancedKey)).toMatchObject({
      turnId: "turn-1",
      role: "user",
    });
  });

  it("fails closed for raw legacy markers and ambiguous turn IDs", () => {
    expect(
      parseTutorTurnMessageKey("tutor-unit:topic:agent-turn:turn-1:user"),
    ).toBeNull();
    expect(() => tutorTurnMessageKey("topic", "turn:1", "user")).toThrow(
      "colon-free",
    );
  });
});
