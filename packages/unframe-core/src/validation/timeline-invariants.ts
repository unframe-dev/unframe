import type { PresentationDefinition } from "@unframe/contracts/presentation";

import type { Diagnostic } from "../domain/model.js";
import { diagnostic, hasCanonicalQuaternionSign, isUnitQuaternion, pathSegment } from "./shared.js";

type Timeline = PresentationDefinition["flow"]["timelines"][string];
type TimelineValue = Timeline["tracks"][number]["keyframes"][number]["value"];

const validValue = (
  property: Timeline["tracks"][number]["target"]["property"],
  value: TimelineValue,
) => {
  switch (property) {
    case "opacity":
      return typeof value === "number" && value >= 0 && value <= 1;
    case "transform.position":
      return Array.isArray(value) && value.length === 3;
    case "transform.scale":
      return Array.isArray(value) && value.length === 3 && value.every((part) => part > 0);
    case "transform.rotation":
      return (
        Array.isArray(value) &&
        value.length === 4 &&
        isUnitQuaternion(value) &&
        hasCanonicalQuaternionSign(value)
      );
  }
};

export const validateTimelineInvariants = (
  definition: PresentationDefinition,
  diagnostics: Diagnostic[],
  options: { fullDelivery?: boolean } = {},
) => {
  const nodes = definition.scene.nodes;
  for (const [timelineId, timeline] of Object.entries(definition.flow.timelines)) {
    const path = `/flow/timelines/${pathSegment(timelineId)}`;
    const claims = new Map<string, string>();
    timeline.tracks.forEach((track, trackIndex) => {
      const trackPath = `${path}/tracks/${trackIndex}`;
      const target = nodes[track.target.nodeId];
      if (target === undefined)
        diagnostics.push(
          diagnostic(
            "reference.invalid",
            `${trackPath}/target/nodeId`,
            "Timeline target must exist.",
          ),
        );
      else {
        if (!options.fullDelivery && target.audience.kind !== "all")
          diagnostics.push(
            diagnostic(
              "graph.invalid",
              `${trackPath}/target/nodeId`,
              "Timeline target must have all audience visibility.",
            ),
          );
        if (
          (timeline.owner.kind === "presentation" && target.owner.kind !== "presentation") ||
          (timeline.owner.kind === "group" &&
            target.owner.kind === "group" &&
            timeline.owner.groupId !== target.owner.groupId)
        )
          diagnostics.push(
            diagnostic(
              "graph.invalid",
              `${trackPath}/target/nodeId`,
              "Timeline target must have a compatible owner lifetime.",
            ),
          );
      }

      const claim = `${track.target.nodeId}\u0000${track.target.property}`;
      const prior = claims.get(claim);
      if (prior !== undefined)
        diagnostics.push(
          diagnostic(
            "identity.invalid",
            `${trackPath}/target`,
            "Timeline tracks must not claim the same target property twice.",
            prior,
          ),
        );
      else claims.set(claim, `${trackPath}/target`);

      track.keyframes.forEach((keyframe, frameIndex) => {
        const framePath = `${trackPath}/keyframes/${frameIndex}`;
        const last = frameIndex === track.keyframes.length - 1;
        const expectedTime =
          frameIndex === 0 ? 0 : last ? timeline.durationMilliseconds : undefined;
        if (expectedTime !== undefined && keyframe.timeMilliseconds !== expectedTime)
          diagnostics.push(
            diagnostic(
              "behavior.invalid",
              `${framePath}/timeMilliseconds`,
              "Timeline track must start at zero and end at its duration.",
            ),
          );
        if (
          frameIndex > 0 &&
          keyframe.timeMilliseconds <= track.keyframes[frameIndex - 1]!.timeMilliseconds
        )
          diagnostics.push(
            diagnostic(
              "behavior.invalid",
              `${framePath}/timeMilliseconds`,
              "Timeline keyframe times must be strictly increasing.",
            ),
          );
        if (
          (last && keyframe.easingToNext !== undefined) ||
          (!last && keyframe.easingToNext === undefined)
        )
          diagnostics.push(
            diagnostic(
              "behavior.invalid",
              `${framePath}/easingToNext`,
              "Only nonfinal keyframes must specify easingToNext.",
            ),
          );
        if (!validValue(track.target.property, keyframe.value))
          diagnostics.push(
            diagnostic(
              "behavior.invalid",
              `${framePath}/value`,
              "Timeline value must match its property and range; rotation must be canonical.",
            ),
          );
      });
    });
  }
};
