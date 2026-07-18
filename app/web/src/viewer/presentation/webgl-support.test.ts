import { describe, expect, it } from "vitest";
import { detectWebGLSupport } from "./webgl-support";

describe("detectWebGLSupport", () => {
  it("returns false when no WebGL context can be created", () => {
    expect(detectWebGLSupport(() => null)).toBe(false);
  });

  it("returns true when a WebGL context is available", () => {
    expect(detectWebGLSupport(() => ({}) as WebGLRenderingContext)).toBe(true);
  });

  it("treats context creation errors as unavailable", () => {
    expect(
      detectWebGLSupport(() => {
        throw new Error("context blocked");
      }),
    ).toBe(false);
  });
});
