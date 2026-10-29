import { describe, expect, it } from "vitest";
import { parseWireUInt } from "../wire-validation";

describe("wire integer parsing", () => {
  it("distinguishes noncanonical input from values outside safe integer range", () => {
    expect(parseWireUInt("01")).toEqual({ success: false, reason: "invalid" });
    expect(parseWireUInt("9007199254740992")).toEqual({ success: false, reason: "unsafe" });
    expect(parseWireUInt(undefined)).toEqual({ success: true, value: 0 });
    expect(parseWireUInt("9007199254740991")).toEqual({
      success: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });
});
