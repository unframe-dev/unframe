import type { FlowDeclaration } from "@unframe-dev/authoring";
import type { Diagnostic, PresentationDefinition } from "@unframe-dev/presentation";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { hashJson } from "./support.js";

export const sceneTimelineId = (presentationId: string, timelineId: string) =>
  `t:${hashJson(JSON.stringify(["scene-timeline-v1", presentationId, timelineId])).slice(7)}`;

export const lowerSceneTimelines = (
  presentationId: string,
  declarations: FlowDeclaration["timelines"],
  hosts: ReadonlyMap<string, string>,
  timelines: PresentationDefinition["flow"]["timelines"],
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const [index, timeline] of (declarations ?? []).entries()) {
    const path = ["presentation", "flow", "timelines", index];
    const id = sceneTimelineId(presentationId, timeline.id);
    if (Object.hasOwn(timelines, id)) {
      diagnostics.push(
        diagnostic(
          "compiler-duplicate-timeline-id",
          path,
          `Scene Timeline "${timeline.id}" is declared more than once. Use a unique Timeline ID.`,
        ),
      );
      continue;
    }
    const tracks: PresentationDefinition["flow"]["timelines"][string]["tracks"] = [];
    for (const [trackIndex, track] of timeline.tracks.entries()) {
      const nodeId = hosts.get(track.target.instanceId);
      if (!nodeId) {
        diagnostics.push(
          diagnostic(
            "compiler-timeline-target-not-found",
            [...path, "tracks", trackIndex, "target"],
            `Scene Timeline "${timeline.id}" targets missing instance "${track.target.instanceId}". Use an ID declared in scene.`,
          ),
        );
        continue;
      }
      tracks.push({
        target: { nodeId, property: track.target.property },
        keyframes: track.keyframes.map((keyframe) => {
          if (
            track.target.property !== "transform.rotation" ||
            !Array.isArray(keyframe.value) ||
            keyframe.value.length !== 4
          )
            return {
              ...keyframe,
              value: Array.isArray(keyframe.value) ? [...keyframe.value] : keyframe.value,
            };
          const length = Math.hypot(...keyframe.value);
          if (!Number.isFinite(length) || length === 0) {
            diagnostics.push(
              diagnostic(
                "compiler-invalid-quaternion",
                [...path, "tracks", trackIndex, "keyframes"],
                `Rotation in Scene Timeline "${timeline.id}" must be a finite nonzero quaternion.`,
              ),
            );
            return { ...keyframe, value: [0, 0, 0, 1] };
          }
          const normalized = keyframe.value.map((value) => value / length);
          const sign =
            ([normalized[3], normalized[0], normalized[1], normalized[2]].find(
              (value) => value !== 0,
            ) ?? 1) < 0
              ? -1
              : 1;
          return {
            ...keyframe,
            value: normalized.map((value) => (value === 0 ? 0 : value * sign)),
          };
        }) as PresentationDefinition["flow"]["timelines"][string]["tracks"][number]["keyframes"],
      });
    }
    timelines[id] = {
      id,
      owner: timeline.owner ? { ...timeline.owner } : { kind: "presentation" },
      durationMilliseconds: timeline.durationMilliseconds,
      tracks,
    };
  }
  return diagnostics;
};
