export type FlashcardStatus = "candidate" | "approved" | "rejected";
export type FlashcardExportFormat = "markdown" | "csv" | "tsv";

export interface Flashcard {
  readonly id: string;
  readonly front: string;
  readonly back: string;
  readonly tags: readonly string[];
  readonly status: FlashcardStatus;
}

export interface FlashcardExportOptions {
  readonly includeHeader?: boolean;
}

export function exportFlashcards(
  cards: readonly Flashcard[],
  format: FlashcardExportFormat,
  options: FlashcardExportOptions = {},
): string {
  const approved = cards.filter((card) => card.status === "approved");
  switch (format) {
    case "markdown":
      return exportMarkdown(approved);
    case "csv":
      return exportDelimited(approved, ",", options.includeHeader ?? true);
    case "tsv":
      return exportDelimited(approved, "\t", options.includeHeader ?? true);
  }
}

/** Prefixes spreadsheet formulas without destroying their visible contents. */
export function neutralizeSpreadsheetFormula(value: string): string {
  const startsWithControlCharacter =
    // eslint-disable-next-line no-control-regex -- spreadsheet hardening must detect C0/C1 prefixes.
    /^[\u0000-\u001f\u007f-\u009f\ufeff]/u.test(value);
  const hasFormulaAfterIgnorablePrefix =
    /^[\p{White_Space}\p{Cc}\ufeff]*[=+\-@]/u.test(value);
  return startsWithControlCharacter || hasFormulaAfterIgnorablePrefix
    ? `'${value}`
    : value;
}

function exportMarkdown(cards: readonly Flashcard[]): string {
  const lines = ["| Front | Back | Tags |", "| --- | --- | --- |"];
  for (const card of cards) {
    lines.push(
      `| ${escapeMarkdownCell(card.front)} | ${escapeMarkdownCell(card.back)} | ${escapeMarkdownCell(card.tags.join(" "))} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function exportDelimited(
  cards: readonly Flashcard[],
  delimiter: "," | "\t",
  includeHeader: boolean,
): string {
  const rows: string[][] = cards.map((card) => [
    card.front,
    card.back,
    card.tags.join(" "),
  ]);
  if (includeHeader) rows.unshift(["Front", "Back", "Tags"]);
  if (rows.length === 0) return "";
  return `${rows.map((row) => row.map((cell) => escapeDelimitedCell(cell, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}

function escapeDelimitedCell(value: string, delimiter: "," | "\t"): string {
  const safe = neutralizeSpreadsheetFormula(value);
  if (safe.includes(delimiter) || /["\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function escapeMarkdownCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>");
}
