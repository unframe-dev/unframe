import { expect, it } from "vitest";
import { createRuntimeClock } from "../runtime-clock";

it("advances running time but does not restart its reference for unchanged State updates", () => {
  let now = 100;
  const clock = createRuntimeClock(() => now);
  clock.synchronize({ runtimeTimeMilliseconds: 2000, lifecycle: { kind: "running" } });
  now = 350;
  expect(clock.read()).toBe(2250);
  clock.synchronize({ runtimeTimeMilliseconds: 2000, lifecycle: { kind: "running" } });
  now = 600;
  expect(clock.read()).toBe(2500);
});
it("freezes on pause and termination, reanchors on resume and clears on reset", () => {
  let now = 0;
  const clock = createRuntimeClock(() => now);
  clock.synchronize({ runtimeTimeMilliseconds: 100, lifecycle: { kind: "running" } });
  now = 500;
  clock.synchronize({
    runtimeTimeMilliseconds: 450,
    lifecycle: { kind: "paused", reason: "explicit-pause" },
  });
  now = 1500;
  expect(clock.read()).toBe(450);
  clock.synchronize({ runtimeTimeMilliseconds: 450, lifecycle: { kind: "running" } });
  now = 1700;
  expect(clock.read()).toBe(650);
  clock.synchronize({
    runtimeTimeMilliseconds: 650,
    lifecycle: { kind: "terminating", reason: "explicit-end" },
  });
  now = 9999;
  expect(clock.read()).toBe(650);
  clock.reset();
  expect(clock.read()).toBeNull();
});
it("clamps local backward movement and rejects invalid remote time", () => {
  let now = 100;
  const clock = createRuntimeClock(() => now);
  clock.synchronize({ runtimeTimeMilliseconds: 50, lifecycle: { kind: "running" } });
  now = 90;
  expect(clock.read()).toBe(50);
  expect(() =>
    clock.synchronize({ runtimeTimeMilliseconds: NaN, lifecycle: { kind: "running" } }),
  ).toThrow();
});
