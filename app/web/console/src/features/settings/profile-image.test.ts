import { describe, expect, it } from "vitest";
import { squareCrop } from "./profile-image";

describe("squareCrop", () => {
  it("centers a square inside a landscape image", () => {
    expect(squareCrop(1200, 800, 1, 0, 0)).toEqual({ x: 200, y: 0, size: 800 });
  });

  it("allows a zoomed portrait image to reach its bottom-right edge", () => {
    expect(squareCrop(800, 1200, 2, 1, 1)).toEqual({ x: 400, y: 800, size: 400 });
  });
});
