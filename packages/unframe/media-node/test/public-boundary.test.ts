import { expect, it } from "vitest";
import { resizeRgba } from "@unframe/media-node";

it("rejects an invalid image through the media package", () => {
  expect(resizeRgba({}).valid).toBe(false);
});
