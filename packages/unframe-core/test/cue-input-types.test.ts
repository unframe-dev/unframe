import { describe, expect, it } from "vitest";

import type { CueInput } from "../src/index.js";

const common = {
  actor: { kind: "participant", role: "presenter" },
  payload: {},
  causeEventId: "event-1",
} as const;
const subject = { kind: "participant", owner: { kind: "presenter" } } as const;

describe("CueInput type", () => {
  it("accepts the required fields for each trigger kind", () => {
    const inputs = [
      { kind: "logicalInput", action: "next", ...common },
      { kind: "semanticEvent", event: "ready", ...common },
      { kind: "surfaceInteraction", surfaceId: "surface", interactionId: "click", ...common },
      { kind: "zoneEdge", zoneId: "zone", edge: "enter", subject, ...common },
      { kind: "motion", distanceMeters: 1, windowMilliseconds: 100, subject, ...common },
      { kind: "timer", cueId: "cue", ...common },
      { kind: "timelineCompleted", timelineId: "timeline", ...common },
    ] as const satisfies readonly CueInput[];

    expect(inputs).toHaveLength(7);
  });
});

const rejectedInputs = () => {
  // @ts-expect-error logical input requires an action
  const logical: CueInput = { kind: "logicalInput", ...common };
  // @ts-expect-error semantic event requires an event
  const semantic: CueInput = { kind: "semanticEvent", ...common };
  // @ts-expect-error surface interaction requires both identifiers
  const surface: CueInput = { kind: "surfaceInteraction", surfaceId: "surface", ...common };
  // @ts-expect-error zone edge requires an edge
  const zone: CueInput = { kind: "zoneEdge", zoneId: "zone", subject, ...common };
  // @ts-expect-error motion requires a measured distance
  const motion: CueInput = { kind: "motion", windowMilliseconds: 100, subject, ...common };
  // @ts-expect-error timer requires a cue id
  const timer: CueInput = { kind: "timer", ...common };
  // @ts-expect-error timeline completion requires a timeline id
  const timeline: CueInput = { kind: "timelineCompleted", ...common };
  // @ts-expect-error logical input cannot carry an unrelated timeline id
  const unrelated: CueInput = { kind: "logicalInput", action: "next", timelineId: "x", ...common };
  void [logical, semantic, surface, zone, motion, timer, timeline, unrelated];
};
void rejectedInputs;
