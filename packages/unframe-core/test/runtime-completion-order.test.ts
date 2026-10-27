import { describe, expect, it } from "vitest";
import { presentationDefinitionSchema, renderBundleSchema } from "@unframe/contracts/presentation";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import {
  advanceCueClock,
  createCueState,
  executeCueEvent,
  validatePresentationDefinition,
} from "../src/index.js";

const timeline = {
  name: "Timeline",
  action: {
    kind: "timeline.play",
    timelineId: "fade",
    completion: "nonBlocking",
    conflict: "reject",
  },
  trigger: { kind: "timelineCompleted", timelineId: "fade" },
} as const;
const media = {
  name: "Media",
  action: { kind: "media.play", surfaceId: "video" },
  trigger: { kind: "mediaCompleted", surfaceId: "video" },
} as const;
const model = {
  name: "Model",
  action: {
    kind: "modelClip.play",
    nodeId: "model",
    clipId: "wave",
    speed: 1,
    loop: false,
    completion: "nonBlocking",
    transition: { kind: "immediate" },
    conflict: "reject",
  },
  trigger: { kind: "modelClipCompleted", nodeId: "model", clipId: "wave" },
} as const;

describe("canonical completion order", () => {
  it.each([
    { first: timeline, second: media },
    { first: timeline, second: model },
    { first: media, second: model },
  ])("completes $first.name before $second.name at the same logical time", ({ first, second }) => {
    const definition = presentationDefinitionSchema.parse(structuredClone(definitionFixture));
    const bundle = renderBundleSchema.parse(structuredClone(bundleFixture));
    definition.flow.timelines.fade = {
      id: "fade",
      owner: { kind: "presentation" },
      durationMilliseconds: 1000,
      tracks: [
        {
          target: { nodeId: "model", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 1000, value: 1 },
          ],
        },
      ],
    };
    const group = definition.flow.groups.intro!;
    group.steps.first = { id: "first", cues: [] };
    group.steps.second = { id: "second", cues: [] };
    group.steps.start!.cues = [
      {
        id: "start",
        order: 0,
        priority: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [second.action, first.action],
        next: { kind: "stay" },
      },
      {
        id: "firstDone",
        order: 1,
        priority: 0,
        trigger: first.trigger,
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "step", stepId: "first" },
      },
      {
        id: "secondDone",
        order: 2,
        priority: 0,
        trigger: second.trigger,
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "step", stepId: "second" },
      },
    ];
    expect(validatePresentationDefinition(definition, { fullDelivery: true }).valid).toBe(true);
    const started = executeCueEvent(definition, createCueState(definition, 9, bundle), {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "start",
    });
    expect(started.outcome.kind).toBe("accepted");
    const completed = advanceCueClock(definition, started.state, 1000, { capture: true });
    expect(completed.outcomes).toEqual([{ kind: "accepted", cueId: "firstDone" }]);
    expect(completed.state.currentStepId).toBe("first");
    expect(completed.captures).toMatchObject([
      { cueId: "firstDone", state: { currentStepId: "start", runtimeTimeMilliseconds: 1000 } },
    ]);
  });
});
