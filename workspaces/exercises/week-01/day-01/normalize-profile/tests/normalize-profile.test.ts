import { describe, expect, it } from "vitest";

import { normalizeProfile } from "../src/normalize-profile.js";

describe("normalizeProfile", () => {
  it("нормализует строки, сохраняет ноль и создаёт новый массив тегов", () => {
    const tags = ["  typescript ", "", "react"];
    const input = { id: " user-1 ", displayName: "", age: 0, tags };

    const result = normalizeProfile(input);

    expect(result).toEqual({
      ok: true,
      profile: {
        id: "user-1",
        displayName: "",
        age: 0,
        tags: ["typescript", "", "react"],
      },
    });
    if (result.ok) {
      expect(result.profile.tags).not.toBe(tags);
    }
    expect(input).toEqual({ id: " user-1 ", displayName: "", age: 0, tags });
  });

  it("отличает отсутствующий displayName от переданной пустой строки", () => {
    const result = normalizeProfile({ id: "user-1" });

    expect(result).toEqual({
      ok: false,
      issues: [{ field: "displayName", message: "Поле обязательно" }],
    });
  });

  it("отвергает значение, которое не является объектом", () => {
    expect(normalizeProfile(null)).toEqual({
      ok: false,
      issues: [{ field: "profile", message: "Ожидался объект" }],
    });
    expect(normalizeProfile(["not", "a", "profile"])).toEqual({
      ok: false,
      issues: [{ field: "profile", message: "Ожидался объект" }],
    });
  });

  it("возвращает все ошибки полей в стабильном порядке", () => {
    expect(
      normalizeProfile({
        id: "   ",
        displayName: 42,
        age: -1,
        tags: ["ok", 2],
      }),
    ).toEqual({
      ok: false,
      issues: [
        { field: "id", message: "Нужна непустая строка" },
        { field: "displayName", message: "Ожидалась строка" },
        { field: "age", message: "Нужно целое неотрицательное число" },
        { field: "tags", message: "Ожидался массив строк" },
      ],
    });
  });

  it("не добавляет отсутствующие optional-поля", () => {
    const result = normalizeProfile({ id: "user-2", displayName: " Ada " });

    expect(result).toEqual({
      ok: true,
      profile: { id: "user-2", displayName: "Ada", tags: [] },
    });
    if (result.ok) {
      expect(Object.hasOwn(result.profile, "age")).toBe(false);
    }
  });
});
