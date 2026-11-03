import type { PresentationDefinition } from "@unframe-dev/contracts/presentation";
import type { PreviewSpatialState } from "@unframe-dev/contracts/author-http";
import type { CueState } from "@unframe-dev/playback";

type Position = [number, number, number];
export type SpatialSnapshot = {
  presenterPosition: Position;
  presenterRotation: [number, number, number, number];
  inside: Record<string, boolean>;
  context: string;
};
export const spatialContext = (state: CueState, playing: boolean, inspectionId?: string) =>
  JSON.stringify([
    state.assignmentEpoch,
    state.currentGroupId,
    state.currentStepId,
    state.groupEntryEpoch,
    state.stepEntryEpoch,
    state.inputEpoch,
    state.phase.kind,
    state.ended,
    playing,
    inspectionId,
  ]);
const zones = (definition: PresentationDefinition) =>
  Object.entries(definition.stage.zones).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const activeZone = (definition: PresentationDefinition, state: CueState, zoneId: string) => {
  const zone = definition.stage.zones[zoneId]!;
  return (
    !state.ended &&
    state.phase.kind === "stable" &&
    (zone.owner.kind === "presentation" || zone.owner.groupId === state.currentGroupId) &&
    (definition.flow.groups[state.currentGroupId]?.steps[state.currentStepId]?.cues ?? []).some(
      (cue) => cue.trigger.kind === "zoneEdge" && cue.trigger.zoneId === zoneId,
    )
  );
};
export const sampleSpatial = (
  definition: PresentationDefinition,
  state: CueState,
  context: string,
  position: Position,
  previous?: SpatialSnapshot,
) => {
  const seeded = previous?.context === context;
  const inside: Record<string, boolean> = {};
  const edges: Array<{ zoneId: string; edge: "enter" | "exit" }> = [];
  for (const [zoneId, zone] of zones(definition)) {
    const boundary = seeded && previous.inside[zoneId] ? 1.03 : 1;
    const current = position.every(
      (coordinate, axis) => Math.abs(coordinate - zone.center[axis]!) <= boundary,
    );
    inside[zoneId] = current;
    if (seeded && current !== previous.inside[zoneId] && activeZone(definition, state, zoneId))
      edges.push({ zoneId, edge: current ? "enter" : "exit" });
  }
  return {
    snapshot: {
      presenterPosition: [...position] as Position,
      presenterRotation: previous?.presenterRotation ?? [0, 0, 0, 1],
      inside,
      context,
    },
    edges,
  };
};
export const projectSpatial = (
  definition: PresentationDefinition,
  state: CueState,
  snapshot: SpatialSnapshot,
): PreviewSpatialState => {
  const entries = zones(definition);
  return {
    presenterPosition: [...snapshot.presenterPosition],
    presenterRotation: [...snapshot.presenterRotation],
    zones: entries.map(([zoneId, zone]) => ({
      zoneId,
      center: [...zone.center],
      active: activeZone(definition, state, zoneId),
      inside: snapshot.inside[zoneId] ?? false,
    })),
  };
};
