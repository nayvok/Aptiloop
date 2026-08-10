import { describe, expect, it } from "vitest";

import {
  completedBlockCount,
  focusedUnit,
  groupDayIntoBlocks,
  remainingDayMinutes,
  type BlockUnit,
} from "@/lib/learning-blocks";
import { catalogs } from "@/lib/i18n";
import { formatDuration, formatMinutesShort } from "@/lib/time";
import {
  activityTone,
  depthMessageKey,
  sourceKindMessageKey,
  unitTypeMessageKeys,
} from "@/lib/unit-labels";

function unit(id: string, type: BlockUnit["type"], minutes: number): BlockUnit {
  return { id, type, title: `${type}-${id}`, estimatedMinutes: minutes };
}

function statusMap(
  entries: Array<[string, "completed" | "in_progress" | "ready" | "locked"]>,
) {
  const map = new Map(entries);
  return (candidate: BlockUnit) =>
    (map.get(candidate.id) ?? "locked") as
      "completed" | "in_progress" | "ready" | "locked";
}

describe("groupDayIntoBlocks", () => {
  it("группирует units в три блока в правильном порядке", () => {
    const units = [
      unit("b", "briefing", 6),
      unit("s1", "study", 18),
      unit("r", "recall", 15),
      unit("q", "quiz", 10),
      unit("e", "exercise", 45),
      unit("rv", "review", 15),
      unit("sm", "summary", 10),
    ];
    const blocks = groupDayIntoBlocks(
      units,
      statusMap([
        ["b", "completed"],
        ["s1", "in_progress"],
      ]),
    );
    expect(blocks.map((block) => block.id)).toEqual([
      "study",
      "check",
      "practice",
    ]);
    expect(blocks[0]!.units.map((item) => item.id)).toEqual(["b", "s1"]);
    expect(blocks[1]!.units.map((item) => item.id)).toEqual(["r", "q"]);
    expect(blocks[2]!.units.map((item) => item.id)).toEqual(["e", "rv", "sm"]);
  });

  it("считает статус, прогресс и время блока", () => {
    const blocks = groupDayIntoBlocks(
      [unit("b", "briefing", 6), unit("s1", "study", 18)],
      statusMap([
        ["b", "completed"],
        ["s1", "ready"],
      ]),
    );
    const study = blocks[0]!;
    expect(study.status).toBe("ready");
    expect(study.completedCount).toBe(1);
    expect(study.totalCount).toBe(2);
    expect(study.currentStepIndex).toBe(2);
    expect(study.currentUnit?.id).toBe("s1");
    expect(study.estimatedMinutes).toBe(24);
    expect(study.remainingMinutes).toBe(18);
  });

  it("завершённый блок не имеет текущего шага", () => {
    const blocks = groupDayIntoBlocks(
      [unit("b", "briefing", 6), unit("s1", "study", 18)],
      statusMap([
        ["b", "completed"],
        ["s1", "completed"],
      ]),
    );
    expect(blocks[0]!.status).toBe("completed");
    expect(blocks[0]!.currentStepIndex).toBeNull();
    expect(blocks[0]!.remainingMinutes).toBe(0);
  });

  it("блок in_progress, когда текущий шаг начат", () => {
    const blocks = groupDayIntoBlocks(
      [unit("r", "recall", 15)],
      statusMap([["r", "in_progress"]]),
    );
    expect(blocks[1]!.status).toBe("in_progress");
  });

  it("считает оставшееся время дня и завершённые блоки", () => {
    const blocks = groupDayIntoBlocks(
      [
        unit("b", "briefing", 6),
        unit("s1", "study", 18),
        unit("r", "recall", 15),
      ],
      statusMap([["b", "completed"]]),
    );
    expect(remainingDayMinutes(blocks)).toBe(18 + 15);
    expect(completedBlockCount(blocks)).toBe(0);
  });
});

describe("focusedUnit", () => {
  it("выбирает in_progress, затем ready, затем последний завершённый", () => {
    const units = [
      unit("b", "briefing", 6),
      unit("s1", "study", 18),
      unit("r", "recall", 15),
    ];
    expect(
      focusedUnit(
        units,
        statusMap([
          ["b", "completed"],
          ["s1", "ready"],
        ]),
      ),
    ).toEqual(units[1]);
    expect(
      focusedUnit(
        units,
        statusMap([
          ["b", "completed"],
          ["s1", "completed"],
          ["r", "in_progress"],
        ]),
      )?.id,
    ).toBe("r");
  });
});

describe("форматирование времени", () => {
  it("форматирует минуты", () => {
    expect(formatMinutesShort(18, "ru-RU")).toBe("18 мин");
    expect(formatMinutesShort(168, "ru-RU")).toBe("2 ч 48 мин");
    expect(formatMinutesShort(120, "ru-RU")).toBe("2 ч");
    expect(formatDuration(18, "ru-RU")).toBe("≈ 18 мин");
    expect(formatDuration(168, "en-US")).toBe("≈ 2 hr 48 min");
    expect(formatDuration(120, "en-US")).toBe("≈ 2 hr");
  });
});

describe("learner labels", () => {
  it("использует понятную терминологию", () => {
    expect(catalogs["ru-RU"][unitTypeMessageKeys.study]).toBe("Изучение");
    expect(catalogs["en-US"][unitTypeMessageKeys.recall]).toBe("Recall");
    expect(catalogs["ru-RU"][unitTypeMessageKeys["teacher-dialogue"]]).toBe(
      "Разбор с преподавателем",
    );
    expect(catalogs["en-US"][unitTypeMessageKeys.exercise]).toBe(
      "Practice exercise",
    );
  });

  it("переводит глубину и источники", () => {
    expect(catalogs["ru-RU"][depthMessageKey("interview-ready")!]).toBe(
      "Для собеседования",
    );
    expect(catalogs["en-US"][depthMessageKey("foundation")!]).toBe(
      "Foundation",
    );
    expect(catalogs["ru-RU"][sourceKindMessageKey("documentation")!]).toBe(
      "Документация",
    );
    expect(sourceKindMessageKey("custom")).toBeNull();
  });

  it("сопоставляет activity tone для каждого типа", () => {
    expect(activityTone.study).toBe("study");
    expect(activityTone.review).toBe("review");
    expect(activityTone.exercise).toBe("practice");
  });
});
