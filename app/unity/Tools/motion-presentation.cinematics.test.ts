import assert from "node:assert/strict";
import test from "node:test";
import {
  completeRuntimeRun,
  createCueState,
  executeCueEvent,
} from "../../../packages/unframe-core/src/runtime/cue-executor.ts";
import { generateMotionPresentation } from "./generate-motion-presentation.ts";

const generated = generateMotionPresentation();
const { definition } = generated;
type Timeline = (typeof definition.flow.timelines)[string];
type Track = Timeline["tracks"][number];

test("visible elements keep their opacity when the next operation begins", () => {
  const opacity = new Map(
    Object.values(definition.scene.nodes).map((node) => [node.id, node.opacity]),
  );
  for (const [name, value] of Object.entries(generated.files)) {
    if (!name.startsWith("Control/")) continue;
    const timelineId = (value as { reliableEvent: { timelineStarted: { timelineId: string } } })
      .reliableEvent.timelineStarted.timelineId;
    for (const track of definition.flow.timelines[timelineId]!.tracks) {
      if (track.target.property !== "opacity") continue;
      assert.equal(
        track.keyframes[0]!.value,
        opacity.get(track.target.nodeId),
        `${timelineId}/${track.target.nodeId}: avoid a brightness jump between operations`,
      );
      opacity.set(track.target.nodeId, track.keyframes.at(-1)!.value as number);
    }
  }
});

function trackFor(scene: string, node: string, property: Track["target"]["property"]): Track {
  const track = definition.flow.timelines[`timeline:scene-${scene}`]!.tracks.find(
    (candidate) => candidate.target.nodeId === node && candidate.target.property === property,
  );
  assert.ok(track, `${scene}: ${node} requires ${property}`);
  return track;
}

function vectors(track: Track) {
  return track.keyframes.map((frame) => {
    assert.ok(Array.isArray(frame.value), "Expected vector keyframes");
    return { time: frame.timeMilliseconds, value: frame.value, easing: frame.easingToNext };
  });
}

function assertEndingHold(track: Track, timeline: Timeline) {
  const last = track.keyframes.at(-1)!;
  let holdStart = track.keyframes.length - 1;
  while (holdStart > 0) {
    const previous = track.keyframes[holdStart - 1]!;
    if (JSON.stringify(previous.value) !== JSON.stringify(last.value)) break;
    holdStart--;
  }
  assert.ok(
    timeline.durationMilliseconds - track.keyframes[holdStart]!.timeMilliseconds >= 150,
    `${track.target.nodeId}: leave at least 150 ms to read the final pose`,
  );
  assert.equal(last.timeMilliseconds, timeline.durationMilliseconds);
}

test("falling models pause, anticipate, accelerate and settle at staggered landing times", () => {
  const timeline = definition.flow.timelines["timeline:scene-10"]!;
  const model = trackFor("10", "node:model-1", "transform.position");
  const frames = vectors(model);
  assert.deepEqual(frames[1]!.value, frames[0]!.value, "Pause before the fall");
  assert.ok(frames[1]!.time > frames[0]!.time, "The initial pause needs time");
  const initialY = frames[0]!.value[1]!;
  const finalY = frames.at(-1)!.value[1]!;
  assert.ok(
    frames.some((frame) => frame.value[1]! > initialY),
    "Lift slightly before falling",
  );
  assert.ok(
    frames.some(
      (frame, index) =>
        frame.easing === "cubicIn" &&
        frames[index + 1] &&
        frames[index + 1]!.value[1]! < frame.value[1]!,
    ),
    "The falling segment should accelerate",
  );
  assert.ok(
    frames.some((frame) => frame.value[1]! < finalY),
    "Overshoot below the resting height",
  );
  assertEndingHold(model, timeline);
  const landings = Array.from({ length: 5 }, (_, index) => {
    const track = trackFor("10", `node:model-${index + 1}`, "transform.position");
    const frames = vectors(track);
    const restingY = frames.at(-1)!.value[1]!;
    const landing = frames.find((frame) => frame.value[1]! <= restingY);
    assert.ok(landing, `model-${index + 1} must land`);
    return landing.time;
  });
  assert.equal(new Set(landings).size, 5, "Five models should land with a cascading rhythm");
});

test("spread-hands scaling uses squash, overshoot and a readable resting hold", () => {
  const timeline = definition.flow.timelines["timeline:scene-16"]!;
  const track = trackFor("16", "node:model-1", "transform.scale");
  const frames = vectors(track);
  const start = frames[0]!.value;
  const end = frames.at(-1)!.value;
  const squash = frames.findIndex((frame) =>
    frame.value.every((value, axis) => value < start[axis]!),
  );
  const overshoot = frames.findIndex((frame) =>
    frame.value.every((value, axis) => value > end[axis]!),
  );
  assert.ok(squash > 0, "Compress before growing");
  assert.ok(overshoot > squash, "Grow beyond the target after the squash");
  assertEndingHold(track, timeline);
});

for (const [previous, next] of [
  ["01", "02"],
  ["20", "21"],
]) {
  test(`scene ${next} waits for the previous text to disappear before fading in`, () => {
    const outgoing = trackFor(next!, `node:scene-${previous}`, "opacity");
    const incoming = trackFor(next!, `node:scene-${next}`, "opacity");
    const hidden = outgoing.keyframes.find((frame) => frame.value === 0);
    assert.ok(hidden, "The previous text must become invisible");
    const fadeStart = incoming.keyframes.findIndex((frame, index) => {
      const following = incoming.keyframes[index + 1];
      return (
        frame.value === 0 && following && typeof following.value === "number" && following.value > 0
      );
    });
    assert.ok(fadeStart >= 0, "The new text must have an explicit entry fade");
    assert.ok(
      hidden.timeMilliseconds <= incoming.keyframes[fadeStart]!.timeMilliseconds,
      "Do not overlap two paragraphs while reading",
    );
  });
}

test("opening text has a clear heading hierarchy and stays light against dark panels", () => {
  const content = definition.scene.surfaces["surface:scene-01"]!.content;
  assert.equal(content.kind, "structured");
  if (content.kind !== "structured") throw Error("Expected structured text");
  const texts = Object.values(content.nodes).filter((node) => node.kind === "text");
  const heading = texts.find((node) => node.semanticNodeId === "title")!;
  const body = texts.find((node) => node.semanticNodeId === "body")!;
  assert.ok(heading && body, "Keep the title and body independently styled");
  assert.ok(heading.style.fontSize / body.style.fontSize >= 1.7, "The title should lead the body");
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  for (const surface of Object.values(definition.scene.surfaces)) {
    if (!/^surface:scene-(0[1-5]|2[0-4])$/.test(surface.id)) continue;
    if (surface.content.kind !== "structured") continue;
    for (const node of Object.values(surface.content.nodes)) {
      if (node.kind !== "text") continue;
      const { red, green, blue, alpha } = node.style.color;
      const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
      assert.ok(
        luminance >= 0.45 && alpha >= 0.9,
        `${surface.id}/${node.id}: use readable light text`,
      );
    }
  }
});

test("the 25-event rehearsal preserves its empty pauses and completes after the closing scene", () => {
  const controls = Object.entries(generated.files).filter(([name]) => name.startsWith("Control/"));
  assert.equal(controls.length, 25);
  let state = createCueState(definition, 1);
  const emptyScenes = new Set(["timeline:scene-09", "timeline:scene-13"]);
  for (const [, value] of controls) {
    const start = (
      value as {
        reliableEvent: { timelineStarted: { cause: { cueId: string }; timelineId: string } };
      }
    ).reliableEvent.timelineStarted;
    const cue = definition.flow.groups[state.currentGroupId]!.steps[state.currentStepId]!.cues.find(
      (candidate) => candidate.id === start.cause.cueId,
    )!;
    assert.ok(cue);
    const event =
      cue.trigger.kind === "motion"
        ? {
            kind: "motion" as const,
            actor: cue.trigger.actor,
            subject: cue.trigger.subject,
            ...("preset" in cue.trigger ? { preset: cue.trigger.preset } : {}),
            distanceMeters: cue.trigger.minimumDistanceMeters,
            windowMilliseconds: cue.trigger.windowMilliseconds,
            payload: {},
            causeEventId: cue.id,
          }
        : {
            kind: "logicalInput" as const,
            actor: { kind: "participant" as const, role: "presenter" as const },
            action: "next",
            payload: {},
            causeEventId: cue.id,
          };
    const result = executeCueEvent(definition, state, event);
    assert.equal(result.outcome.kind, "accepted");
    state = result.state;
    const run = state.activeRuns.at(-1)!;
    assert.equal(run.kind, "timeline");
    if (run.kind !== "timeline") throw Error("Expected blocking timeline");
    state.runtimeTimeMilliseconds +=
      definition.flow.timelines[run.timelineId]!.durationMilliseconds;
    const completion = completeRuntimeRun(definition, state, run.runId);
    assert.equal(completion.completed, true);
    state = completion.state;
    if (emptyScenes.delete(run.timelineId))
      for (const node of Object.values(definition.scene.nodes))
        if (node.kind !== "container")
          assert.equal(state.nodes[node.id]!.opacity, 0, `${run.timelineId}/${node.id}`);
  }
  assert.equal(emptyScenes.size, 0, "Visit both empty pauses");
  assert.equal(state.ended, true);
  assert.equal(state.nodes["node:scene-24"]!.opacity, 1, "Keep the closing Thanks visible");
});
