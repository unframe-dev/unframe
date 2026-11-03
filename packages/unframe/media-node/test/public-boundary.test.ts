import { expect, it } from "vite-plus/test";
import { resizeRgba } from "@unframe-dev/media-node";

it("rejects an invalid image through the media package", () => {
  expect(resizeRgba({}).valid).toBe(false);
});
