export interface StrictJsonLimits {
  readonly maxBytes: number;
  readonly maxDecodedCharacters: number;
  readonly maxDepth: number;
  readonly maxItems: number;
  readonly maxStringCharacters: number;
  readonly maxParseMilliseconds: number;
}

export const COURSE_PACK_JSON_LIMITS_V1: StrictJsonLimits = Object.freeze({
  maxBytes: 1_048_576,
  maxDecodedCharacters: 900_000,
  maxDepth: 32,
  maxItems: 20_000,
  maxStringCharacters: 50_000,
  maxParseMilliseconds: 100,
});

export type StrictJsonErrorCode =
  | "BYTE_LIMIT_EXCEEDED"
  | "INVALID_UTF8"
  | "UTF8_BOM"
  | "TEXT_LIMIT_EXCEEDED"
  | "INVALID_JSON"
  | "DUPLICATE_KEY"
  | "DEPTH_LIMIT_EXCEEDED"
  | "ITEM_LIMIT_EXCEEDED"
  | "STRING_LIMIT_EXCEEDED"
  | "PARSE_TIME_LIMIT_EXCEEDED";

export class StrictJsonError extends Error {
  constructor(
    readonly code: StrictJsonErrorCode,
    readonly offset: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StrictJsonError";
  }
}

export interface StrictJsonParseOptions {
  readonly limits?: StrictJsonLimits;
  readonly now?: () => number;
}

/** Parses exactly one UTF-8 JSON value while rejecting duplicate object keys. */
export function parseStrictJson(
  bytes: Uint8Array,
  options: StrictJsonParseOptions = {},
): unknown {
  const limits = options.limits ?? COURSE_PACK_JSON_LIMITS_V1;
  if (bytes.byteLength > limits.maxBytes) {
    throw new StrictJsonError(
      "BYTE_LIMIT_EXCEEDED",
      0,
      `JSON document exceeds ${limits.maxBytes} bytes`,
    );
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new StrictJsonError("UTF8_BOM", 0, "UTF-8 BOM is not accepted");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new StrictJsonError(
      "INVALID_UTF8",
      0,
      "JSON document is not valid UTF-8",
      {
        cause: error,
      } as ErrorOptions,
    );
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new StrictJsonError("UTF8_BOM", 0, "UTF-8 BOM is not accepted");
  }
  if (text.length > limits.maxDecodedCharacters) {
    throw new StrictJsonError(
      "TEXT_LIMIT_EXCEEDED",
      0,
      `Decoded JSON exceeds ${limits.maxDecodedCharacters} characters`,
    );
  }

  return new Parser(
    text,
    limits,
    options.now ?? performance.now.bind(performance),
  ).parse();
}

class Parser {
  #offset = 0;
  #items = 0;
  #checks = 0;
  readonly #startedAt: number;

  constructor(
    readonly text: string,
    readonly limits: StrictJsonLimits,
    readonly now: () => number,
  ) {
    this.#startedAt = now();
  }

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.#offset !== this.text.length) {
      this.fail("INVALID_JSON", "Unexpected characters after the JSON value");
    }
    this.checkTime(true);
    return value;
  }

  parseValue(depth: number): unknown {
    if (depth > this.limits.maxDepth) {
      this.fail(
        "DEPTH_LIMIT_EXCEEDED",
        `JSON nesting exceeds depth ${this.limits.maxDepth}`,
      );
    }
    this.checkTime(false);
    const character = this.text[this.#offset];
    if (character === "{") return this.parseObject(depth);
    if (character === "[") return this.parseArray(depth);
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || isDigit(character)) return this.parseNumber();
    this.fail("INVALID_JSON", "Expected a JSON value");
  }

  parseObject(depth: number): Record<string, unknown> {
    this.#offset += 1;
    this.skipWhitespace();
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    const keys = new Set<string>();
    if (this.text[this.#offset] === "}") {
      this.#offset += 1;
      return result;
    }
    while (true) {
      if (this.text[this.#offset] !== '"') {
        this.fail("INVALID_JSON", "Expected an object key");
      }
      const keyOffset = this.#offset;
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError(
          "DUPLICATE_KEY",
          keyOffset,
          `Duplicate object key: ${key}`,
        );
      }
      keys.add(key);
      this.countItem();
      this.skipWhitespace();
      if (this.text[this.#offset] !== ":") {
        this.fail("INVALID_JSON", "Expected ':' after an object key");
      }
      this.#offset += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const separator = this.text[this.#offset];
      if (separator === "}") {
        this.#offset += 1;
        return result;
      }
      if (separator !== ",") {
        this.fail("INVALID_JSON", "Expected ',' or '}' in an object");
      }
      this.#offset += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth: number): unknown[] {
    this.#offset += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.text[this.#offset] === "]") {
      this.#offset += 1;
      return result;
    }
    while (true) {
      this.countItem();
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const separator = this.text[this.#offset];
      if (separator === "]") {
        this.#offset += 1;
        return result;
      }
      if (separator !== ",") {
        this.fail("INVALID_JSON", "Expected ',' or ']' in an array");
      }
      this.#offset += 1;
      this.skipWhitespace();
    }
  }

  parseString(): string {
    const start = this.#offset;
    this.#offset += 1;
    while (this.#offset < this.text.length) {
      const code = this.text.charCodeAt(this.#offset);
      if (code === 0x22) {
        this.#offset += 1;
        let value: string;
        try {
          value = JSON.parse(this.text.slice(start, this.#offset)) as string;
        } catch (error) {
          throw new StrictJsonError(
            "INVALID_JSON",
            start,
            "Invalid JSON string escape",
            { cause: error } as ErrorOptions,
          );
        }
        if (value.length > this.limits.maxStringCharacters) {
          throw new StrictJsonError(
            "STRING_LIMIT_EXCEEDED",
            start,
            `JSON string exceeds ${this.limits.maxStringCharacters} characters`,
          );
        }
        return value;
      }
      if (code < 0x20) {
        this.fail("INVALID_JSON", "Unescaped control character in JSON string");
      }
      if (code === 0x5c) {
        this.#offset += 1;
        const escape = this.text[this.#offset];
        if (escape === "u") {
          for (let index = 1; index <= 4; index += 1) {
            if (!isHexDigit(this.text[this.#offset + index])) {
              this.fail(
                "INVALID_JSON",
                "Invalid Unicode escape in JSON string",
              );
            }
          }
          this.#offset += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          this.fail("INVALID_JSON", "Invalid escape in JSON string");
        }
      }
      this.#offset += 1;
    }
    this.fail("INVALID_JSON", "Unterminated JSON string");
  }

  parseNumber(): number {
    const start = this.#offset;
    if (this.text[this.#offset] === "-") this.#offset += 1;
    if (this.text[this.#offset] === "0") {
      this.#offset += 1;
      if (isDigit(this.text[this.#offset])) {
        this.fail("INVALID_JSON", "Leading zero in JSON number");
      }
    } else {
      if (!isNonZeroDigit(this.text[this.#offset])) {
        this.fail("INVALID_JSON", "Invalid JSON number");
      }
      while (isDigit(this.text[this.#offset])) this.#offset += 1;
    }
    if (this.text[this.#offset] === ".") {
      this.#offset += 1;
      if (!isDigit(this.text[this.#offset])) {
        this.fail("INVALID_JSON", "Missing fraction digits in JSON number");
      }
      while (isDigit(this.text[this.#offset])) this.#offset += 1;
    }
    const exponent = this.text[this.#offset];
    if (exponent === "e" || exponent === "E") {
      this.#offset += 1;
      const sign = this.text[this.#offset];
      if (sign === "+" || sign === "-") this.#offset += 1;
      if (!isDigit(this.text[this.#offset])) {
        this.fail("INVALID_JSON", "Missing exponent digits in JSON number");
      }
      while (isDigit(this.text[this.#offset])) this.#offset += 1;
    }
    const value = Number(this.text.slice(start, this.#offset));
    if (!Number.isFinite(value)) {
      throw new StrictJsonError(
        "INVALID_JSON",
        start,
        "JSON number must be finite",
      );
    }
    return value;
  }

  parseLiteral<T>(token: string, value: T): T {
    if (!this.text.startsWith(token, this.#offset)) {
      this.fail("INVALID_JSON", `Invalid JSON literal; expected ${token}`);
    }
    this.#offset += token.length;
    return value;
  }

  skipWhitespace(): void {
    while (
      this.text[this.#offset] === " " ||
      this.text[this.#offset] === "\n" ||
      this.text[this.#offset] === "\r" ||
      this.text[this.#offset] === "\t"
    ) {
      this.#offset += 1;
    }
  }

  countItem(): void {
    this.#items += 1;
    if (this.#items > this.limits.maxItems) {
      this.fail(
        "ITEM_LIMIT_EXCEEDED",
        `JSON container entries exceed ${this.limits.maxItems}`,
      );
    }
  }

  checkTime(force: boolean): void {
    this.#checks += 1;
    if (
      (force || this.#checks % 256 === 0) &&
      this.now() - this.#startedAt > this.limits.maxParseMilliseconds
    ) {
      this.fail(
        "PARSE_TIME_LIMIT_EXCEEDED",
        `JSON parsing exceeded ${this.limits.maxParseMilliseconds} ms`,
      );
    }
  }

  fail(code: StrictJsonErrorCode, message: string): never {
    throw new StrictJsonError(code, this.#offset, message);
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isNonZeroDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "1" && value <= "9";
}

function isHexDigit(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ((value >= "0" && value <= "9") ||
      (value >= "a" && value <= "f") ||
      (value >= "A" && value <= "F"))
  );
}
