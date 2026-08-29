export type StrictJsonPrimitive = boolean | null | number | string;
export type StrictJsonValue = StrictJsonPrimitive | StrictJsonRecord | readonly StrictJsonValue[];
export interface StrictJsonRecord {
  readonly [key: string]: StrictJsonValue;
}

type StrictJsonFailureCode =
  | "cli-lock-json-bom"
  | "cli-lock-json-duplicate-key"
  | "cli-lock-json-invalid-utf8"
  | "cli-lock-json-lone-surrogate"
  | "cli-lock-json-number"
  | "cli-lock-json-resource-limit"
  | "cli-lock-json-syntax";

export type StrictJsonParseResult =
  | { readonly ok: true; readonly value: StrictJsonValue }
  | { readonly ok: false; readonly code: StrictJsonFailureCode };

const MAX_INPUT_BYTES = 64 * 1_024 * 1_024;
const MAX_NESTING_DEPTH = 64;

class ParseFailure extends Error {
  override readonly name = "ParseFailure";

  constructor(readonly code: StrictJsonFailureCode) {
    super(code);
  }
}

const fail = (code: StrictJsonFailureCode): never => {
  throw new ParseFailure(code);
};

const isWhitespace = (character: string) =>
  character === " " || character === "\n" || character === "\r" || character === "\t";

const isDigit = (character: string | undefined) =>
  character !== undefined && character >= "0" && character <= "9";

const isHexDigit = (character: string | undefined) =>
  character !== undefined &&
  ((character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F"));

class StrictJsonParser {
  #index = 0;

  constructor(readonly source: string) {}

  parse(): StrictJsonValue {
    this.#skipWhitespace();
    const value = this.#value(0);
    this.#skipWhitespace();
    if (this.#index !== this.source.length) fail("cli-lock-json-syntax");
    return value;
  }

  #value(depth: number): StrictJsonValue {
    const character = this.source[this.#index];
    if (character === "{") return this.#object(depth + 1);
    if (character === "[") return this.#array(depth + 1);
    if (character === '"') return this.#string();
    if (character === "-" || isDigit(character)) return this.#number();
    if (this.source.startsWith("true", this.#index)) {
      this.#index += 4;
      return true;
    }
    if (this.source.startsWith("false", this.#index)) {
      this.#index += 5;
      return false;
    }
    if (this.source.startsWith("null", this.#index)) {
      this.#index += 4;
      return null;
    }
    return fail("cli-lock-json-syntax");
  }

  #object(depth: number): StrictJsonRecord {
    if (depth > MAX_NESTING_DEPTH) fail("cli-lock-json-resource-limit");
    this.#index += 1;
    this.#skipWhitespace();
    const record: Record<string, StrictJsonValue> = Object.create(null) as Record<
      string,
      StrictJsonValue
    >;
    if (this.source[this.#index] === "}") {
      this.#index += 1;
      return record;
    }
    while (true) {
      if (this.source[this.#index] !== '"') fail("cli-lock-json-syntax");
      const key = this.#string();
      if (Object.hasOwn(record, key)) fail("cli-lock-json-duplicate-key");
      this.#skipWhitespace();
      if (this.source[this.#index] !== ":") fail("cli-lock-json-syntax");
      this.#index += 1;
      this.#skipWhitespace();
      record[key] = this.#value(depth);
      this.#skipWhitespace();
      const separator = this.source[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return record;
      }
      if (separator !== ",") fail("cli-lock-json-syntax");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #array(depth: number): readonly StrictJsonValue[] {
    if (depth > MAX_NESTING_DEPTH) fail("cli-lock-json-resource-limit");
    this.#index += 1;
    this.#skipWhitespace();
    const values: StrictJsonValue[] = [];
    if (this.source[this.#index] === "]") {
      this.#index += 1;
      return values;
    }
    while (true) {
      values.push(this.#value(depth));
      this.#skipWhitespace();
      const separator = this.source[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return values;
      }
      if (separator !== ",") fail("cli-lock-json-syntax");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #string(): string {
    this.#index += 1;
    let value = "";
    while (this.#index < this.source.length) {
      const character = this.source[this.#index++]!;
      if (character === '"') return value;
      if (character === "\\") {
        value += this.#escape();
        continue;
      }
      const code = character.charCodeAt(0);
      if (code < 0x20) fail("cli-lock-json-syntax");
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = this.source[this.#index];
        if (next === undefined || next.charCodeAt(0) < 0xdc00 || next.charCodeAt(0) > 0xdfff)
          fail("cli-lock-json-lone-surrogate");
        value += character + next;
        this.#index += 1;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) fail("cli-lock-json-lone-surrogate");
      value += character;
    }
    return fail("cli-lock-json-syntax");
  }

  #escape(): string {
    const escape = this.source[this.#index++];
    if (escape === '"' || escape === "\\" || escape === "/") return escape;
    if (escape === "b") return "\b";
    if (escape === "f") return "\f";
    if (escape === "n") return "\n";
    if (escape === "r") return "\r";
    if (escape === "t") return "\t";
    if (escape !== "u") return fail("cli-lock-json-syntax");

    const codeUnit = this.#unicodeEscape();
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) fail("cli-lock-json-lone-surrogate");
    if (codeUnit < 0xd800 || codeUnit > 0xdbff) return String.fromCharCode(codeUnit);
    if (this.source[this.#index] !== "\\" || this.source[this.#index + 1] !== "u")
      fail("cli-lock-json-lone-surrogate");
    this.#index += 2;
    const lowSurrogate = this.#unicodeEscape();
    if (lowSurrogate < 0xdc00 || lowSurrogate > 0xdfff) fail("cli-lock-json-lone-surrogate");
    return String.fromCharCode(codeUnit, lowSurrogate);
  }

  #unicodeEscape(): number {
    const start = this.#index;
    for (let offset = 0; offset < 4; offset += 1) {
      if (!isHexDigit(this.source[this.#index + offset])) fail("cli-lock-json-syntax");
    }
    this.#index += 4;
    return Number.parseInt(this.source.slice(start, this.#index), 16);
  }

  #number(): number {
    const start = this.#index;
    if (this.source[this.#index] === "-") this.#index += 1;
    if (this.source[this.#index] === "0") this.#index += 1;
    else {
      if (!isDigit(this.source[this.#index])) fail("cli-lock-json-syntax");
      while (isDigit(this.source[this.#index])) this.#index += 1;
    }
    if (this.source[this.#index] === ".") {
      this.#index += 1;
      if (!isDigit(this.source[this.#index])) fail("cli-lock-json-syntax");
      while (isDigit(this.source[this.#index])) this.#index += 1;
    }
    if (this.source[this.#index] === "e" || this.source[this.#index] === "E") {
      this.#index += 1;
      if (this.source[this.#index] === "+" || this.source[this.#index] === "-") this.#index += 1;
      if (!isDigit(this.source[this.#index])) fail("cli-lock-json-syntax");
      while (isDigit(this.source[this.#index])) this.#index += 1;
    }
    const value = Number(this.source.slice(start, this.#index));
    if (!Number.isFinite(value)) fail("cli-lock-json-number");
    return value;
  }

  #skipWhitespace(): void {
    while (isWhitespace(this.source[this.#index] ?? "")) this.#index += 1;
  }
}

export const parseStrictJson = (input: Uint8Array): StrictJsonParseResult => {
  if (input.byteLength > MAX_INPUT_BYTES)
    return { ok: false, code: "cli-lock-json-resource-limit" };
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    return { ok: false, code: "cli-lock-json-invalid-utf8" };
  }
  if (source.charCodeAt(0) === 0xfeff) return { ok: false, code: "cli-lock-json-bom" };
  try {
    return { ok: true, value: new StrictJsonParser(source).parse() };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, code: error.code };
    return { ok: false, code: "cli-lock-json-syntax" };
  }
};
