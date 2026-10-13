import { assert, describe, expect, it } from "vitest";

import { parseStrictJson } from "../src/filesystem/strict-json.js";

const bytes = (source: string) => new TextEncoder().encode(source);

describe("strict JSON lock boundary", () => {
  it("decodes valid JSON into null-prototype records without changing its input", () => {
    const input = bytes('{"__proto__":{"safe":true},"items":[1,false,null]}');
    const before = [...input];

    const result = parseStrictJson(input);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBe(null);
    const record = result.value as Record<string, unknown>;
    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(record["__proto__"]).toEqual({ safe: true });
    expect(record.items).toEqual([1, false, null]);
    expect([...input]).toEqual(before);
  });

  it.each([
    [new Uint8Array([0xed, 0xa0, 0x80]), "cli-lock-json-invalid-utf8"],
    [bytes("\ufeff{}"), "cli-lock-json-bom"],
    [bytes('{"a":1,}'), "cli-lock-json-syntax"],
    [bytes('{"a":1,// comment\n"b":2}'), "cli-lock-json-syntax"],
    [bytes('{"n":NaN}'), "cli-lock-json-syntax"],
    [bytes('{"n":Infinity}'), "cli-lock-json-syntax"],
    [bytes('{"a":1,"\\u0061":2}'), "cli-lock-json-duplicate-key"],
    [bytes('{"value":"\\ud800"}'), "cli-lock-json-lone-surrogate"],
    [bytes('{"value":1e999}'), "cli-lock-json-number"],
  ] as const)("rejects unsafe input with stable code %s", (input, code) => {
    expect(parseStrictJson(input)).toEqual({ ok: false, code });
  });

  it("accepts an escaped surrogate pair", () => {
    expect(parseStrictJson(bytes('{"value":"\\ud83d\\ude00"}'))).toMatchObject({ ok: true });
  });

  it("accepts actual UTF-8 non-BMP characters in keys and values", () => {
    expect(parseStrictJson(bytes('{"😀":"😀"}'))).toEqual({
      ok: true,
      value: Object.assign(Object.create(null), { "😀": "😀" }),
    });
  });

  it("rejects resource-limit input without exposing host errors", () => {
    const input = bytes(`[${"[".repeat(100)}${"0"}${"]".repeat(100)}]`);
    expect(parseStrictJson(input)).toEqual({ ok: false, code: "cli-lock-json-resource-limit" });
  });
  it("accepts native base64 lock strings larger than 64 MiB within the 128 MiB profile", () => {
    const payloadBytes = 65 * 1_024 * 1_024;
    const input = new Uint8Array(payloadBytes + 2);
    input.fill(0x41);
    input[0] = 0x22;
    input[input.length - 1] = 0x22;

    const result = parseStrictJson(input);

    assert.isTrue(result.ok);
    const value = result.value;
    assert(typeof value === "string");
    expect(value.length).toBe(payloadBytes);
    expect(value.slice(0, 4)).toBe("AAAA");
    expect(value.slice(-4)).toBe("AAAA");
  });

  it("rejects input exceeding the 128 MiB profile before decoding", () => {
    const input = new Uint8Array(128 * 1_024 * 1_024 + 1);
    expect(parseStrictJson(input)).toEqual({ ok: false, code: "cli-lock-json-resource-limit" });
  });

  it("decodes mixed escape sequences and adjacent literal surrogate pairs", () => {
    const source = String.raw`"head\n\t\b\f\r\/\\\"\u0061\ud83d\ude00😀tail"`;
    expect(parseStrictJson(bytes(source))).toEqual({
      ok: true,
      value: 'head\n\t\b\f\r/\\"a😀😀tail',
    });
  });

  it.each([
    String.raw`"\x"`,
    String.raw`"\u123"`,
    String.raw`"\udc00"`,
    String.raw`"\ud800\u0041"`,
    '"literal\ncontrol"',
    '"unterminated',
  ])("rejects malformed string token %s", (source) => {
    expect(parseStrictJson(bytes(source)).ok).toBe(false);
  });
});
