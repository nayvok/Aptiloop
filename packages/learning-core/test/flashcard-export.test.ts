import { describe, expect, it } from "vitest";

import {
  exportFlashcards,
  neutralizeSpreadsheetFormula,
  type Flashcard,
} from "../src/flashcard-export.js";

const cards: Flashcard[] = [
  {
    id: "approved-1",
    front: "What is a closure?",
    back: "A function plus its lexical environment.",
    tags: ["javascript", "functions"],
    status: "approved",
  },
  {
    id: "candidate-1",
    front: "Unreviewed",
    back: "Must not leak into export",
    tags: [],
    status: "candidate",
  },
  {
    id: "rejected-1",
    front: "Rejected",
    back: "Must not leak either",
    tags: [],
    status: "rejected",
  },
];

describe("flashcard export", () => {
  it("exports approved cards only as Markdown", () => {
    const output = exportFlashcards(cards, "markdown");
    expect(output).toContain("| Front | Back | Tags |");
    expect(output).toContain("What is a closure?");
    expect(output).toContain("javascript functions");
    expect(output).not.toContain("Unreviewed");
    expect(output).not.toContain("Rejected");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("escapes Markdown table syntax, backslashes, and line breaks", () => {
    const output = exportFlashcards(
      [
        {
          id: "special",
          front: "a | b",
          back: "path\\name\nnext",
          tags: [],
          status: "approved",
        },
      ],
      "markdown",
    );
    expect(output).toContain("a \\| b");
    expect(output).toContain("path\\\\name<br>next");
  });

  it("uses RFC-style CSV escaping", () => {
    const output = exportFlashcards(
      [
        {
          id: "csv",
          front: "one, two",
          back: 'He said "yes"\nthen left',
          tags: ["a"],
          status: "approved",
        },
      ],
      "csv",
    );
    expect(output).toBe(
      'Front,Back,Tags\r\n"one, two","He said ""yes""\nthen left",a\r\n',
    );
  });

  it("exports TSV and can omit its header", () => {
    const output = exportFlashcards(cards, "tsv", { includeHeader: false });
    expect(output).toBe(
      "What is a closure?\tA function plus its lexical environment.\tjavascript functions\r\n",
    );
  });

  it.each([
    "=1+1",
    "+cmd",
    "-2+3",
    "@SUM(A1:A2)",
    '  =HYPERLINK("x")',
    "\tformula",
    "\ufeff=1+1",
    "\u00a0@SUM(A1:A2)",
    "\fformula",
  ])("neutralizes spreadsheet formula payload %j", (payload) => {
    expect(neutralizeSpreadsheetFormula(payload)).toBe(`'${payload}`);
  });

  it("does not alter ordinary cell values", () => {
    expect(neutralizeSpreadsheetFormula("What is ===?")).toBe("What is ===?");
  });

  it("applies formula safety to every CSV and TSV field before quoting", () => {
    const dangerous: Flashcard = {
      id: "dangerous",
      front: "=1+1",
      back: "+cmd,with-comma",
      tags: ["@tag"],
      status: "approved",
    };
    expect(exportFlashcards([dangerous], "csv", { includeHeader: false })).toBe(
      "'=1+1,\"'+cmd,with-comma\",'@tag\r\n",
    );
    expect(exportFlashcards([dangerous], "tsv", { includeHeader: false })).toBe(
      "'=1+1\t'+cmd,with-comma\t'@tag\r\n",
    );
  });

  it("returns deterministic empty exports", () => {
    expect(exportFlashcards([], "markdown")).toBe(
      "| Front | Back | Tags |\n| --- | --- | --- |\n",
    );
    expect(exportFlashcards([], "csv")).toBe("Front,Back,Tags\r\n");
    expect(exportFlashcards([], "tsv", { includeHeader: false })).toBe("");
  });
});
