import { expect, it } from "vitest";
import { isFixtureRoute } from "../routes";
it("opens fixture controls only in development with an explicit query", () => {
  expect(isFixtureRoute(true, "?fixture=1&size=36")).toBe(true);
  expect(isFixtureRoute(true, "")).toBe(false);
  expect(isFixtureRoute(true, "?fixture=0")).toBe(false);
  expect(isFixtureRoute(false, "?fixture=1")).toBe(false);
  expect(isFixtureRoute(true, "?fixture=1&fixture=0")).toBe(false);
});

it("位置合わせ画面は明示的な開発用URLのみで公開", async () => {
  const { isTrackingRoute } = await import("../routes");
  expect(isTrackingRoute(true, "?tracking=1&size=36")).toBe(true);
  expect(isTrackingRoute(false, "?tracking=1")).toBe(false);
  expect(isTrackingRoute(true, "?tracking=1&tracking=1")).toBe(false);
});
