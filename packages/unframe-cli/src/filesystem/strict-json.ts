import { visit } from "jsonc-parser";

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

// Native packages are embedded as base64 in the fixed Node dependency graph.
const MAX_INPUT_BYTES = 128 * 1_024 * 1_024;
const MAX_NESTING_DEPTH = 64;

class ParseFailure extends Error {
  override readonly name = "ParseFailure";

  constructor(readonly code: StrictJsonFailureCode) {
    super(code);
  }
}

function fail(code: StrictJsonFailureCode): never {
  throw new ParseFailure(code);
}

type Container =
  | { readonly kind: "array"; readonly value: StrictJsonValue[] }
  | {
      readonly kind: "object";
      readonly value: Record<string, StrictJsonValue>;
      property: string | undefined;
    };

const validateString = (value: string): void => {
  // Unicode mode matches surrogate code points only when they are not paired.
  if (/\p{Surrogate}/u.test(value)) fail("cli-lock-json-lone-surrogate");
};

const parseSource = (source: string): StrictJsonValue => {
  const containers: Container[] = [];
  let result: StrictJsonValue | undefined;

  const append = (value: StrictJsonValue): void => {
    const parent = containers.at(-1);
    if (parent === undefined) result = value;
    else if (parent.kind === "array") parent.value.push(value);
    else {
      if (parent.property === undefined) fail("cli-lock-json-syntax");
      parent.value[parent.property] = value;
      parent.property = undefined;
    }
  };

  const begin = (container: Container): void => {
    if (containers.length >= MAX_NESTING_DEPTH) fail("cli-lock-json-resource-limit");
    append(container.value);
    containers.push(container);
  };

  visit(
    source,
    {
      onObjectBegin: () => {
        begin({
          kind: "object",
          value: Object.create(null) as Record<string, StrictJsonValue>,
          property: undefined,
        });
      },
      onObjectProperty: (property) => {
        validateString(property);
        const parent = containers.at(-1);
        if (parent?.kind !== "object") fail("cli-lock-json-syntax");
        if (Object.hasOwn(parent.value, property)) fail("cli-lock-json-duplicate-key");
        parent.property = property;
      },
      onObjectEnd: () => {
        containers.pop();
      },
      onArrayBegin: () => {
        begin({ kind: "array", value: [] });
      },
      onArrayEnd: () => {
        containers.pop();
      },
      onLiteralValue: (value: StrictJsonPrimitive) => {
        if (typeof value === "string") validateString(value);
        if (typeof value === "number" && !Number.isFinite(value)) fail("cli-lock-json-number");
        append(value);
      },
      onError: () => fail("cli-lock-json-syntax"),
    },
    { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false },
  );

  if (result === undefined) fail("cli-lock-json-syntax");
  return result;
};

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
    return { ok: true, value: parseSource(source) };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, code: error.code };
    return { ok: false, code: "cli-lock-json-syntax" };
  }
};
