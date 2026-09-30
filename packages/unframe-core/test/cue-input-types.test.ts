import { describe, expect, it } from "vitest";

import type { CueInput } from "../src/index.js";

const common = {
  actor: { kind: "participant", role: "presenter" },
  causeEventId: "event-1",
  payload: {},
} as const;
const subject = { kind: "participant", owner: { kind: "presenter" } } as const;

describe("CueInput type", () => {
  it("accepts the required fields for each trigger kind", () => {
    const inputs = [
      { action: "next", kind: "logicalInput", ...common },
      { event: "ready", kind: "semanticEvent", ...common },
      { interactionId: "click", kind: "surfaceInteraction", surfaceId: "surface", ...common },
      { edge: "enter", kind: "zoneEdge", subject, zoneId: "zone", ...common },
      { distanceMeters: 1, kind: "motion", subject, windowMilliseconds: 100, ...common },
      { cueId: "cue", kind: "timer", ...common },
      { kind: "timelineCompleted", timelineId: "timeline", ...common },
    ] as const satisfies ReadonlyArray<CueInput>;

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
  const zone: CueInput = { kind: "zoneEdge", subject, zoneId: "zone", ...common };
  // @ts-expect-error motion requires a measured distance
  const motion: CueInput = { kind: "motion", subject, windowMilliseconds: 100, ...common };
  // @ts-expect-error timer requires a cue id
  const timer: CueInput = { kind: "timer", ...common };
  // @ts-expect-error timeline completion requires a timeline id
  const timeline: CueInput = { kind: "timelineCompleted", ...common };
  // @ts-expect-error logical input cannot carry an unrelated timeline id
  const unrelated: CueInput = { action: "next", kind: "logicalInput", timelineId: "x", ...common };
  void [logical, semantic, surface, zone, motion, timer, timeline, unrelated];
};
void rejectedInputs;
