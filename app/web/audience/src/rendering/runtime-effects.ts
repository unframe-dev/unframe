import { Vector3, type Object3D } from "three";
import type { EffectRunSnapshot } from "@unframe-dev/contracts/presentation";
import { VisualEffects, type EffectHandle, type HandGlowHandle } from "../visual-effects/effects";

export interface RuntimeHandPose {
  hand: "left" | "right";
  sequence: number;
  position: readonly [number, number, number];
}

export function createRuntimeEffects(resolve: (nodeId: string) => Object3D | undefined) {
  const effects = new VisualEffects();
  const runs = new Map<
    string,
    {
      target: Object3D;
      handle: EffectHandle | null;
      hand?: HandGlowHandle;
      sequence: number;
      completed: boolean;
    }
  >();
  return {
    frame(
      snapshot: readonly EffectRunSnapshot[],
      runtimeMs: number,
      poses: readonly RuntimeHandPose[] = [],
      presentationRoot?: Object3D,
    ) {
      const ids = new Set(
        snapshot.map((run) => `${run.runId.assignmentEpoch}:${run.runId.runSequence}`),
      );
      for (const [id, entry] of runs)
        if (!ids.has(id)) {
          entry.handle?.cancel();
          runs.delete(id);
        }
      for (const run of snapshot) {
        const id = `${run.runId.assignmentEpoch}:${run.runId.runSequence}`;
        const target = resolve(run.nodeId);
        let entry = runs.get(id);
        if (entry && entry.target !== target) {
          entry.handle?.cancel();
          runs.delete(id);
          entry = undefined;
        }
        if (!target) continue;
        if (!entry) {
          const configuration = run.effect;
          const options = {
            runId: id,
            effectId: configuration.kind,
            size: configuration.size,
            color: [
              configuration.color.red,
              configuration.color.green,
              configuration.color.blue,
              configuration.color.alpha,
            ] as const,
            speed: configuration.speed,
            durationMs: configuration.durationMilliseconds,
            seed: run.seed,
            startedAtRuntimeMs: run.startedAtRuntimeTimeMilliseconds,
            ...(configuration.kind === "wave" ? { waveCycles: configuration.waveCycles } : {}),
          };
          const completed = () => {
            const current = runs.get(id);
            if (current) current.completed = true;
          };
          try {
            const hand =
              configuration.kind === "handGlow"
                ? effects.begin(options, target, completed)
                : undefined;
            entry = {
              target,
              handle: hand ?? effects.play(options, target, completed),
              sequence:
                configuration.kind === "handGlow"
                  ? (poses.find((pose) => pose.hand === configuration.hand)?.sequence ?? -1)
                  : -1,
              completed: false,
              ...(hand ? { hand } : {}),
            };
          } catch {
            entry = { target, handle: null, sequence: -1, completed: false };
          }
          runs.set(id, entry);
        }
        if (run.effect.kind === "handGlow" && entry.hand && !entry.completed) {
          const hand = run.effect.hand;
          const sample = poses.find((value) => value.hand === hand);
          if (
            sample &&
            sample.sequence > entry.sequence &&
            runtimeMs >= run.startedAtRuntimeTimeMilliseconds
          ) {
            const position = new Vector3(...sample.position);
            presentationRoot?.localToWorld(position);
            target.worldToLocal(position);
            entry.hand.updatePose(position, runtimeMs);
            entry.sequence = sample.sequence;
          }
        }
      }
      effects.evaluate(runtimeMs);
      for (const run of snapshot) {
        const entry = runs.get(`${run.runId.assignmentEpoch}:${run.runId.runSequence}`);
        if (entry?.completed && run.effect.kind === "dissolve") entry.target.visible = false;
      }
    },
    dispose() {
      effects.dispose();
      runs.clear();
    },
  };
}
