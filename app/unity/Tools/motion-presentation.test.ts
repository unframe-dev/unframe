import type { DeliveryManifestWire } from "../../../packages/contracts/presentation/wire-types.js";
import { unframe } from "../../../packages/contracts/presentation/wire-static.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatGenerated } from "../../../packages/contracts/scripts/format-generated.ts";
import {
  createCueState,
  executeCueEvent,
  completeRuntimeRun,
} from "../../../packages/unframe-core/src/runtime/cue-executor.ts";
import { generateMotionPresentation } from "./generate-motion-presentation.ts";

test("generated preview files match the canonical definition", () => {
  const { files } = generateMotionPresentation();
  const root = fileURLToPath(new URL("../Assets/Resources/MotionPresentation/", import.meta.url));
  for (const [name, value] of Object.entries(files))
    assert.equal(
      readFileSync(root + name, "utf8"),
      formatGenerated(root + name, JSON.stringify(value, null, 2) + "\n"),
    );
});

test("native UI projection preserves separate title and body text nodes", () => {
  const source = structuredClone(generateMotionPresentation().definition);
  const surface = source.scene.surfaces["surface:scene-01"]!;
  if (surface.content.kind !== "structured") throw Error("Expected structured surface");
  const original = Object.values(surface.content.nodes).find((node) => node.kind === "text");
  if (!original || original.kind !== "text") throw Error("Expected text node");
  const title = {
    ...structuredClone(original),
    id: "title",
    semanticNodeId: "heading",
    order: 0,
    value: { kind: "literal" as const, value: "Unframe" },
    placement: { kind: "absolute" as const, x: 0.4, y: 0.3, width: 5.8, height: 0.8 },
    style: { ...original.style, fontSize: 24, align: "start" as const },
  };
  const body = {
    ...structuredClone(original),
    id: "body",
    semanticNodeId: "description",
    order: 1,
    value: { kind: "literal" as const, value: "身体を使ったMRプレゼンテーション" },
    placement: { kind: "absolute" as const, x: 0.4, y: 1.4, width: 5.8, height: 1.2 },
    style: { ...original.style, fontSize: 16, align: "start" as const },
  };
  const root = surface.content.nodes[surface.content.rootFrameId]!;
  if (root.kind !== "frame") throw Error("Expected root frame");
  surface.content.nodes = { [root.id]: { ...root, children: ["title", "body"] }, title, body };
  surface.baseSemanticTree = {
    rootNodeIds: ["heading", "description"],
    nodes: {
      heading: {
        id: "heading",
        parentId: null,
        order: 0,
        role: "heading",
        level: 1,
        text: title.value.value,
      },
      description: {
        id: "description",
        parentId: null,
        order: 1,
        role: "paragraph",
        text: body.value.value,
      },
    },
  };
  const { files } = generateMotionPresentation(source);
  const delivery = files["LocalDelivery.json"] as DeliveryManifestWire;
  const artifact = delivery.projectionProfile!.renderSurfaces!.find(
    (entry) => entry.semanticSurfaceId === surface.id,
  )!.artifacts![0]!.nativeUi!;
  const group = artifact.nodes!.find((entry) => entry.group)?.group;
  assert.ok(group);
  assert.equal(artifact.rootNodeId, group.nodeId);
  const texts = artifact.nodes!.flatMap((entry) => (entry.text ? [entry.text] : []));
  assert.deepEqual(
    group.childNodeIds,
    texts.map((node) => node.nodeId),
  );
  assert.deepEqual(
    texts.map((node) => [
      node.semanticNodeId,
      node.value!.literal!.value,
      node.fontSize,
      node.align,
    ]),
    [
      ["heading", title.value.value, 24, "NATIVE_TEXT_ALIGN_START"],
      ["description", body.value.value, 16, "NATIVE_TEXT_ALIGN_START"],
    ],
  );
  assert.deepEqual(
    texts.map((node) => node.bounds),
    [
      { x: 0.4, y: 0.3, width: 5.8, height: 0.8 },
      { x: 0.4, y: 1.4, width: 5.8, height: 1.2 },
    ],
  );
});

test("preview generation follows a short presentation to its end", () => {
  const source = generateMotionPresentation().definition;
  const definition = structuredClone(source);
  const group = definition.flow.groups[definition.flow.initialGroupId]!;
  group.steps[group.initialStepId]!.cues[0]!.next = { kind: "end" };
  const generated = generateMotionPresentation(definition);
  assert.equal(
    Object.keys(generated.files).filter((name) => name.startsWith("Control/")).length,
    1,
  );
});

test("the rehearsal follows all 24 scenes and the separate focus operation", () => {
  const { definition, files } = generateMotionPresentation();
  const controls = Object.entries(files).filter(([name]) => name.startsWith("Control/"));
  assert.equal(controls.length, 25);
  assert.deepEqual(
    (files["LocalMotionPlan.json"] as { cues: { preset: string; eventNumber: number }[] }).cues.map(
      (cue) => [cue.eventNumber, cue.preset],
    ),
    [
      [10, "swipeDown"],
      [15, "swipeDown"],
      [16, "swipeRight"],
      [17, "spreadHands"],
    ],
  );
  const root = definition.scene.nodes["node:rehearsal-root"]!;
  assert.deepEqual(root.transform.scale, [0.5, 0.5, 0.5]);
  assert.deepEqual(root.transform.position, [0, 0.35, 0]);
  const panel = definition.scene.nodes["node:main-panel"]!;
  assert.equal(panel.kind, "shape");
  if (panel.kind !== "shape" || panel.geometry.kind !== "box") throw Error("Expected panel");
  assert.equal(panel.geometry.size[0] / panel.geometry.size[1], 16 / 9);
  let state = createCueState(definition, 1);
  for (const [, value] of controls) {
    const event = value as {
      reliableEvent: { timelineStarted: { cause: { cueId: string }; timelineId: string } };
    };
    const start = event.reliableEvent.timelineStarted;
    const cue = definition.flow.groups[state.currentGroupId]!.steps[state.currentStepId]!.cues.find(
      (candidate) => candidate.id === start.cause.cueId,
    )!;
    assert.ok(cue);
    const input =
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
    if (input.kind === "motion" && input.preset) {
      const wrong = executeCueEvent(definition, state, {
        ...input,
        preset: input.preset === "swipeUp" ? "swipeDown" : "swipeUp",
      });
      assert.equal(wrong.outcome.kind, "none");
    }
    const result = executeCueEvent(definition, state, input);
    assert.equal(result.outcome.kind, "accepted");
    state = result.state;
    const run = state.activeRuns.at(-1)!;
    assert.equal(run.kind, "timeline");
    if (run.kind !== "timeline") throw Error("Expected timeline");
    assert.equal(run.timelineId, start.timelineId);
    assert.equal(run.completion, "blocking");
    state.runtimeTimeMilliseconds +=
      definition.flow.timelines[run.timelineId]!.durationMilliseconds;
    const completed = completeRuntimeRun(definition, state, run.runId);
    assert.equal(completed.completed, true);
    state = completed.state;
    const scene = /^timeline:scene-(\d+)$/.exec(run.timelineId);
    const number = scene ? Number(scene[1]) : undefined;
    if (number && number <= 5) {
      assert.equal(state.nodes["node:main-panel"]!.opacity, 1);
      assert.deepEqual(state.nodes["node:main-panel"]!.transform, panel.transform);
      assert.equal(state.nodes[`node:scene-${String(number).padStart(2, "0")}`]!.opacity, 1);
    }
    if (number === 9 || number === 13) {
      for (const [nodeId, node] of Object.entries(definition.scene.nodes))
        if (node.kind !== "container") assert.equal(state.nodes[nodeId]!.opacity, 0, nodeId);
    }
    if (number === 10) {
      assert.equal(state.nodes["node:scene-10"]!.opacity, 1);
      assert.deepEqual(state.nodes["node:scene-10"]!.transform.position, [0, 0, 0.08]);
      for (let i = 1; i <= 5; i++) {
        assert.equal(state.nodes[`node:model-${i}`]!.opacity, 1);
        const track = definition.flow.timelines[run.timelineId]!.tracks.find(
          (track) =>
            track.target.nodeId === `node:model-${i}` &&
            track.target.property === "transform.position",
        )!;
        const from = track.keyframes[0]!.value as number[];
        const to = track.keyframes.at(-1)!.value as number[];
        assert.ok(from[1]! > to[1]!, "Models fall from above");
      }
    }
    if (number === 11) {
      assert.equal(state.nodes["node:scene-10"]!.opacity, 0);
      for (let i = 1; i <= 5; i++) assert.equal(state.nodes[`node:model-${i}`]!.opacity, 1);
    }
    if (run.timelineId === "timeline:scene-12-focus") {
      assert.equal(state.nodes["node:model-1"]!.transform.position[0], 0);
      for (let i = 2; i <= 5; i++)
        assert.ok(state.nodes[`node:model-${i}`]!.transform.position[2]! >= 0);
    }
    if (number && number >= 20) {
      assert.equal(state.nodes[`node:scene-${number}-group`]!.transform.position[2], 0.1);
      assert.equal(state.nodes[`node:scene-${number}-panel`]!.opacity, 0);
      const entry = definition.flow.timelines[run.timelineId]!.tracks.find(
        (track) =>
          track.target.nodeId === `node:scene-${number}-group` &&
          track.target.property === "transform.position",
      );
      assert.ok(entry);
      assert.ok(
        (entry.keyframes[0]!.value as number[])[2]! >
          (entry.keyframes.at(-1)!.value as number[])[2]!,
        "Text moves from the front towards the center",
      );
      if (number > 20) {
        assert.equal(state.nodes[`node:scene-${number - 1}-group`]!.transform.position[2], 0.1);
        assert.equal(state.nodes[`node:scene-${number - 1}`]!.opacity, 0);
      }
    }
  }
  assert.equal(state.ended, true);
});

test("rehearsal content keeps separate headings and bodies inside its surface bounds", () => {
  const { definition } = generateMotionPresentation();
  let splitSurfaceCount = 0;
  let leftAlignedCount = 0;
  for (const surface of Object.values(definition.scene.surfaces)) {
    assert.equal(surface.content.kind, "structured");
    if (surface.content.kind !== "structured") throw Error("Expected structured surface");
    const texts = Object.values(surface.content.nodes).filter((node) => node.kind === "text");
    if (texts.length >= 2) splitSurfaceCount++;
    for (const node of texts) {
      assert.equal(node.placement.kind, "absolute");
      if (node.placement.kind !== "absolute") throw Error("Expected absolute placement");
      const { x, y, width, height } = node.placement;
      assert.ok(x >= 0 && y >= 0, surface.id);
      assert.ok(x + width <= surface.logicalSize[0] + 0.0001, surface.id);
      assert.ok(y + height <= surface.logicalSize[1] + 0.0001, surface.id);
      assert.ok(node.semanticNodeId, surface.id);
      assert.ok(surface.baseSemanticTree.nodes[node.semanticNodeId], surface.id);
      if (node.style.align === "start") leftAlignedCount++;
      if (/^surface:scene-2[0-4]$/.test(surface.id))
        assert.deepEqual(node.style.color, { red: 1, green: 1, blue: 1, alpha: 1 });
    }
  }
  assert.ok(splitSurfaceCount >= 10, "Scenes should have separate heading and body text");
  assert.ok(leftAlignedCount > 0, "Some scenes should use left alignment");
  for (const node of Object.values(definition.scene.nodes))
    assert.ok(node.transform.position[2] >= 0, node.id);
  for (const timeline of Object.values(definition.flow.timelines))
    for (const track of timeline.tracks)
      if (track.target.property === "transform.position")
        for (const keyframe of track.keyframes)
          assert.ok(
            (keyframe.value as number[])[2]! >= 0,
            `${timeline.id}: ${track.target.nodeId}`,
          );
});

test("all generated resources preserve their fields through the protobuf codec", () => {
  const { files } = generateMotionPresentation();
  for (const [name, value] of Object.entries(files)) {
    if (name === "LocalMotionPlan.json") continue;
    const codec =
      name === "LocalDelivery.json"
        ? unframe.delivery.DeliveryManifest
        : unframe.realtime.ControlServerItem;
    const message = codec.fromObject(value as Record<string, unknown>);
    assert.equal(codec.verify(message), null, name);
    assert.deepEqual(message.toJSON(), omitEmptyArrays(value), name);
  }
});

function omitEmptyArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitEmptyArrays);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => !Array.isArray(child) || child.length > 0)
        .map(([key, child]) => [key, omitEmptyArrays(child)]),
    );
  return value;
}
