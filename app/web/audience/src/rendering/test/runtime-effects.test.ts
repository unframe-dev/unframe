import { expect, it } from "vite-plus/test";
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  SkinnedMesh,
  type Object3D,
} from "three";
import type {
  EffectRunSnapshot,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import { createRuntimeEffects, type RuntimeHandPose } from "../runtime-effects";

function run(kind: "wave" | "handGlow" | "dissolve" = "wave"): EffectRunSnapshot {
  return {
    runId: { assignmentEpoch: 1, runSequence: 1 },
    owner: { kind: "presentation" },
    cause: {
      cueId: "cue",
      causeEventId: "event",
      groupId: "g",
      groupEntryEpoch: 1,
      stepId: "s",
      stepEntryEpoch: 1,
    },
    startedAtRuntimeTimeMilliseconds: 100,
    effectId: "effect",
    nodeId: "target",
    seed: 42,
    status: "active",
    effect: {
      kind,
      size: 1,
      color: { red: 1, green: 0, blue: 0, alpha: 1 },
      speed: 1,
      durationMilliseconds: 1000,
      ...(kind === "wave"
        ? { waveCycles: 1 }
        : kind === "handGlow"
          ? { hand: "left" as const }
          : {}),
    } as EffectRunSnapshot["effect"],
  };
}
function frame(
  effects: ReturnType<typeof createRuntimeEffects>,
  effectRuns: EffectRunSnapshot[],
  runtimeMs: number,
  poses: readonly RuntimeHandPose[] = [],
  root?: Object3D,
) {
  effects.frame({ effectRuns, nodeStates: {} }, runtimeMs, poses, root);
}

it("applies sampled node opacity on the first wave frame and restores it on the same run", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  const node = { opacity: 0.25 } as ParticipantRuntimeView["nodeStates"][string];
  const view = { effectRuns: [run()], nodeStates: { target: node } };
  effects.frame(view, 1100);
  const wave = target.children[0]!;
  const line = wave.children[0] as import("three").Line<
    import("three").BufferGeometry,
    import("three").LineBasicMaterial
  >;
  const positions = [...line.geometry.getAttribute("position").array];
  for (const opacity of [0.25, 0, 1]) {
    node.opacity = opacity;
    effects.frame(view, 1100);
    expect(target.children).toEqual([wave]);
    expect(line.material.opacity).toBe(opacity);
    expect(wave.scale.toArray()).toEqual([1, 1, 1]);
    expect([...line.geometry.getAttribute("position").array]).toEqual(positions);
  }
  effects.dispose();
});

it("retains a completed wave, ignores repeated snapshots and releases a removed run", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  frame(effects, [run()], 1100);
  expect(target.children).toHaveLength(1);
  const wave = target.children[0];
  frame(effects, [{ ...run(), status: "retained" }], 5000);
  expect(target.children).toEqual([wave]);
  frame(effects, [], 5000);
  expect(target.children).toHaveLength(0);
});
it("converts fresh presentation poses into target-local space and does not repeat stale samples", () => {
  const root = new Group();
  root.position.set(10, 0, 0);
  const target = new Group();
  target.position.set(2, 0, 0);
  root.add(target);
  const effects = createRuntimeEffects(() => target);
  const pose = { hand: "left" as const, sequence: 1, position: [3, 0, 0] as const };
  frame(effects, [run("handGlow")], 100, [], root);
  frame(effects, [run("handGlow")], 101, [pose], root);
  const halo = target.children[0]!.children[0] as Mesh;
  expect(halo.geometry.getAttribute("position").getX(0)).toBeCloseTo(1.035);
  frame(effects, [run("handGlow")], 1200, [pose], root);
  expect(target.children[0]!.visible).toBe(false);
  effects.dispose();
  frame(effects, [run("handGlow")], 1300, [], root);
  expect(target.children[0]!.visible).toBe(false);
});
it("clears the hand trail when tracking becomes unavailable", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  const pose = { hand: "left" as const, sequence: 1, position: [0, 0, 0] as const };
  frame(effects, [run("handGlow")], 100);
  frame(effects, [run("handGlow")], 110, [pose]);
  expect(target.children[0]!.visible).toBe(true);
  frame(effects, [run("handGlow")], 120);
  expect(target.children[0]!.visible).toBe(false);
  effects.dispose();
});
it("breaks the trail when tracking is lost between rendered frames", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  const pose = { hand: "left" as const, sequence: 1, continuity: 0, position: [0, 0, 0] as const };
  frame(effects, [run("handGlow")], 100);
  frame(effects, [run("handGlow")], 110, [pose]);
  frame(effects, [run("handGlow")], 120, [
    { ...pose, sequence: 2, continuity: 1, position: [5, 0, 0] },
  ]);
  const trail = target.children[0]!.children[1] as Mesh;
  expect(trail.geometry.drawRange.count).toBe(0);
  effects.dispose();
});
it("waits for a newer pose after a synchronization boundary", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  const pose = {
    hand: "left" as const,
    sequence: 1,
    continuity: "0:0",
    position: [0, 0, 0] as const,
  };
  frame(effects, [run("handGlow")], 100);
  frame(effects, [run("handGlow")], 110, [pose]);
  frame(effects, [run("handGlow")], 120, [{ ...pose, sequence: 2, continuity: "1:0" }]);
  expect(target.children[0]!.visible).toBe(false);
  frame(effects, [run("handGlow")], 130, [{ ...pose, sequence: 3, continuity: "1:0" }]);
  expect(target.children[0]!.visible).toBe(true);
  effects.dispose();
});
it("restores dissolve materials at completion without restarting the same run", () => {
  const material = new MeshStandardMaterial();
  const target = new Mesh(new BoxGeometry(), material);
  const effects = createRuntimeEffects(() => target);
  frame(effects, [run("dissolve")], 100);
  expect(target.material).not.toBe(material);
  frame(effects, [run("dissolve")], 1100);
  expect(target.material).toBe(material);
  expect(target.visible).toBe(false);
  target.visible = true;
  frame(effects, [run("dissolve")], 1200);
  expect(target.material).toBe(material);
  expect(target.visible).toBe(false);
});

it.each([
  ["PNG", () => new Mesh(new BoxGeometry(), new MeshBasicMaterial())],
  [
    "transparent model",
    () => new Mesh(new BoxGeometry(), new MeshStandardMaterial({ transparent: true })),
  ],
  ["skinned model", () => new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial())],
] as const)(
  "skips an unsupported %s Dissolve while another Wave continues and releases its resources",
  (_kind, createTarget) => {
    const target = createTarget();
    const waveTarget = new Group();
    const effects = createRuntimeEffects((id) => (id === "wave-target" ? waveTarget : target));
    const dissolve = run("dissolve");
    const wave = { ...run(), runId: { assignmentEpoch: 1, runSequence: 2 }, nodeId: "wave-target" };
    expect(() => frame(effects, [dissolve, wave], 100)).not.toThrow();
    expect(target.visible).toBe(true);
    expect(waveTarget.children).toHaveLength(1);
    const line = waveTarget.children[0]!.children[0] as import("three").Line;
    const initialCount = line.geometry.drawRange.count;
    let released = false;
    line.geometry.addEventListener("dispose", () => {
      released = true;
    });
    frame(effects, [dissolve, wave], 600);
    expect(line.geometry.drawRange.count).toBeGreaterThan(initialCount);
    frame(effects, [], 600);
    expect(released).toBe(true);
    expect(waveTarget.children).toHaveLength(0);
  },
);
it("does not retry an unsupported Dissolve until the failed run is removed", () => {
  const target: Mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const effects = createRuntimeEffects(() => target);
  expect(() => frame(effects, [run("dissolve")], 100)).not.toThrow();
  const material = new MeshStandardMaterial();
  target.material = material;
  frame(effects, [run("dissolve")], 200);
  expect(target.material).toBe(material);
  frame(effects, [], 200);
  frame(effects, [{ ...run("dissolve"), runId: { assignmentEpoch: 1, runSequence: 2 } }], 200);
  expect(target.material).not.toBe(material);
  effects.dispose();
  expect(target.material).toBe(material);
});
it("dissolves model meshes while Wave and HandGlow on the same target stay alive", () => {
  const target = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const material = target.material;
  const effects = createRuntimeEffects(() => target);
  const hand = run("handGlow");
  const wave = { ...run(), runId: { assignmentEpoch: 1, runSequence: 2 } };
  const dissolve = { ...run("dissolve"), runId: { assignmentEpoch: 1, runSequence: 3 } };
  frame(effects, [hand], 100);
  expect(() =>
    frame(effects, [hand, wave, dissolve], 100, [
      { hand: "left", sequence: 1, position: [0, 0, 0] },
    ]),
  ).not.toThrow();
  expect(target.material).not.toBe(material);
  expect(target.children).toHaveLength(2);
  expect(target.children[0]!.visible).toBe(true);
  expect(target.children[1]!.visible).toBe(true);
  effects.dispose();
  expect(target.children).toHaveLength(0);
  expect(target.material).toBe(material);
});
it("starts a new or reconnected HandGlow only from a pose received after that run was first applied", () => {
  const target = new Group();
  const effects = createRuntimeEffects(() => target);
  const oldPose = { hand: "left" as const, sequence: 1, position: [0, 0, 0] as const };
  frame(effects, [run("handGlow")], 100, [oldPose]);
  expect(target.children[0]!.visible).toBe(false);
  frame(effects, [run("handGlow")], 110, [{ ...oldPose, sequence: 2 }]);
  expect(target.children[0]!.visible).toBe(true);
  effects.dispose();
  frame(effects, [run("handGlow")], 120, [oldPose]);
  expect(target.children[0]!.visible).toBe(false);
  frame(effects, [run("handGlow")], 130, [{ ...oldPose, sequence: 2 }]);
  expect(target.children[0]!.visible).toBe(true);
});
