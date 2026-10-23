import { expect, it } from "vitest";
import { timePosition, timeAtPosition } from "../timeline-model";
it("maps time and pointer positions without division by zero", () => {
  expect(timePosition(500, 1000)).toBe(50);
  expect(timePosition(0, 0)).toBe(0);
  expect(timeAtPosition(75, 100, 1000)).toBe(750);
  expect(timeAtPosition(-1, 100, 1000)).toBe(0);
  expect(timeAtPosition(110, 100, 1000)).toBe(1000);
});
