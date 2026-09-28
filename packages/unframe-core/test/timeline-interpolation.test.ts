import { describe, expect, it } from "vitest";

import { evaluateTimelineTrack } from "../src/index.js";
import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

type Track = PresentationDefinitionV2["flow"]["timelines"][string]["tracks"][number];

const track = (
  property: Track["target"]["property"],
  values: [Track["keyframes"][number]["value"], Track["keyframes"][number]["value"]],
  easingToNext: "linear" | "cubicIn" | "cubicOut" | "cubicInOut" = "linear",
): Track => ({
  target: { nodeId: "node", property },
  keyframes: [
    { timeMilliseconds: 0, value: values[0], easingToNext },
    { timeMilliseconds: 100, value: values[1] },
  ],
});

describe("Timeline track interpolation", () => {
  it("keeps exact endpoints and interpolates numbers with the segment easing", () => {
    const opacity = track("opacity", [0, 1], "cubicInOut");
    expect(evaluateTimelineTrack(opacity, 100, -5)).toBe(0);
    expect(evaluateTimelineTrack(opacity, 100, 25)).toBe(0.0625);
    expect(evaluateTimelineTrack(opacity, 100, 75)).toBe(0.9375);
    expect(evaluateTimelineTrack(opacity, 100, 105)).toBe(1);
  });

  it("uses the adjacent keyframes for each segment and interpolates Vector3 componentwise", () => {
    const position: Track = {
      target: { nodeId: "node", property: "transform.position" },
      keyframes: [
        { timeMilliseconds: 0, value: [0, 0, 0], easingToNext: "linear" },
        { timeMilliseconds: 20, value: [4, 8, 12], easingToNext: "cubicOut" },
        { timeMilliseconds: 100, value: [12, 16, 20] },
      ],
    };
    expect(evaluateTimelineTrack(position, 100, 10)).toEqual([2, 4, 6]);
    expect(evaluateTimelineTrack(position, 100, 60)).toEqual([11, 15, 19]);
  });

  it("chooses the shortest Quaternion path and returns normalized rotations", () => {
    const rotation = track("transform.rotation", [
      [0, 0, 0, 1],
      [0, 0, -Math.SQRT1_2, -Math.SQRT1_2],
    ]);
    const middle = evaluateTimelineTrack(rotation, 100, 50) as number[];
    expect(middle[2]).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(middle[3]).toBeCloseTo(Math.cos(Math.PI / 8), 12);

    const nearLinear = track("transform.rotation", [
      [0, 0, 0, 2],
      [0, 0, 0.01, 1],
    ]);
    const nearMiddle = evaluateTimelineTrack(nearLinear, 100, 50) as number[];
    expect(Math.hypot(...nearMiddle)).toBeCloseTo(1, 12);
    expect(nearMiddle[2]).toBeGreaterThan(0);
  });

  it("canonicalizes interpolated Quaternion sign and negative zero", () => {
    const w = Math.sqrt(1 - 0.9 ** 2);
    const rotation = track("transform.rotation", [
      [0.9, 0, 0, w],
      [-0.9, 0, 0, w],
    ]);
    const value = evaluateTimelineTrack(rotation, 100, 75) as number[];
    expect(value[3]).toBeGreaterThan(0);
    expect(value.some((component) => Object.is(component, -0))).toBe(false);
  });
});
