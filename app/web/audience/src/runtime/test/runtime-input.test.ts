import { describe, expect, it } from "vitest";
import { id, uint } from "../runtime-input";

describe("runtime wire inputs", () => {
  it.each([
    [undefined, 0],
    ["0", 0],
    ["42", 42],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ] as const)("reads %s as %s", (input, expected) => {
    expect(uint(input)).toBe(expected);
  });
  it.each(["", "00", "01", "+1", "-0", "-1", "1.0", "1e2", " 1", "1\n", "9007199254740992"])(
    "rejects noncanonical or unsafe value %j with the runtime error",
    (value) => {
      expect(() => uint(value)).toThrow("invalid-runtime-input");
    },
  );
  it.each(["空白を含む ID", " ", "é".repeat(64)])(
    "preserves the UTF-8 identity contract for %s",
    (value) => {
      expect(() => id(value)).not.toThrow();
    },
  );
  it.each([undefined, "", "é".repeat(65)])("rejects absent or oversized identities", (value) => {
    expect(() => id(value)).toThrow("invalid-runtime-input");
  });
});
