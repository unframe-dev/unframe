import {
  advanceCueClock,
  createCueState,
  evaluateTimelineTrack,
  executeCueEvent,
  type CueInput,
} from "@unframe/unframe-core";
import { previewQuadId } from "./scene";
import type {
  PreviewAction,
  PreviewDocument,
  PreviewFrame,
  PreviewState,
  PreviewVector3,
  PreviewQuaternion,
} from "./types";

export function createPreviewState(document: PreviewDocument): PreviewState {
  return createCueState(document.artifacts.definition, 1);
}

export function advancePreview(
  document: PreviewDocument,
  state: PreviewState,
  timeMs: number,
): PreviewState {
  return advanceCueClock(document.artifacts.definition, state, timeMs).state;
}

export function dispatchPreviewAction(
  document: PreviewDocument,
  state: PreviewState,
  input: CueInput,
): PreviewState {
  return executeCueEvent(document.artifacts.definition, state, input).state;
}

export function previewActions(document: PreviewDocument, state: PreviewState): PreviewAction[] {
  if (state.ended || state.phase.kind !== "stable") return [];
  const definition = document.artifacts.definition;
  const cues = definition.flow.groups[state.currentGroupId]?.steps[state.currentStepId]?.cues ?? [];
  const actions: PreviewAction[] = [];
  const seen = new Set<string>();
  for (const cue of cues) {
    const trigger = cue.trigger;
    if (trigger.kind !== "logicalInput" && trigger.kind !== "surfaceInteraction") continue;
    const input: CueInput = {
      kind: trigger.kind,
      ...(trigger.kind === "logicalInput"
        ? { action: trigger.action }
        : { surfaceId: trigger.surfaceId, interactionId: trigger.interactionId }),
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: `preview:${state.stepEntryEpoch}:${cue.id}:${state.runtimeTimeMilliseconds}`,
    } as CueInput;
    if (executeCueEvent(definition, state, input).outcome.kind !== "accepted") continue;
    const id =
      trigger.kind === "logicalInput"
        ? `logical:${trigger.action}`
        : `interaction:${trigger.surfaceId}:${trigger.interactionId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let label = trigger.kind === "logicalInput" ? trigger.action : trigger.interactionId;
    if (trigger.kind === "surfaceInteraction") {
      const stateId = state.surfaces[trigger.surfaceId];
      const nodes = stateId
        ? document.artifacts.renderBundle.surfaces[trigger.surfaceId]?.semanticsByState[stateId]
            ?.nodes
        : undefined;
      const button =
        nodes &&
        Object.values(nodes).find(
          (node) => node.role === "button" && node.interactionId === trigger.interactionId,
        );
      if (button && "text" in button && button.text) label = button.text;
    }
    actions.push({ id, label, input });
  }
  return actions;
}

function nodeProjection(document: PreviewDocument, state: PreviewState) {
  const projected = new Map<
    string,
    { active: boolean; opacity: number; transform: PreviewState["nodes"][string]["transform"] }
  >();
  const definition = document.artifacts.definition;
  const nodeStates = structuredClone(state.nodes);
  for (const run of state.activeRuns) {
    if (run.kind !== "timeline") continue;
    const timeline = definition.flow.timelines[run.timelineId]!;
    const elapsed = state.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds;
    for (const track of timeline.tracks) {
      const node = nodeStates[track.target.nodeId];
      if (!node) continue;
      const value = evaluateTimelineTrack(track, timeline.durationMilliseconds, elapsed);
      if (track.target.property === "opacity") node.opacity = value as number;
      else {
        const key = track.target.property.split(".")[1] as "position" | "rotation" | "scale";
        node.transform[key] = value as never;
      }
    }
  }
  function project(id: string): NonNullable<ReturnType<typeof projected.get>> {
    const cached = projected.get(id);
    if (cached) return cached;
    const definitionNode = definition.scene.nodes[id]!;
    const current = nodeStates[id];
    const parent =
      definitionNode.parent.kind === "node" ? project(definitionNode.parent.nodeId) : null;
    const audienceVisible =
      definitionNode.audience.kind === "all" || definitionNode.audience.role === "presenter";
    const result = {
      active: !!current?.active && !!current.visible && audienceVisible && (parent?.active ?? true),
      opacity: (current?.opacity ?? 0) * (parent?.opacity ?? 1),
      transform: current?.transform ?? definitionNode.transform,
    };
    projected.set(id, result);
    return result;
  }
  for (const node of Object.values(definition.scene.nodes)) project(node.id);
  return projected;
}

export function previewFrame(
  document: PreviewDocument,
  state: PreviewState,
  generation: number,
): PreviewFrame {
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new RangeError("Invalid preview generation.");
  const projected = nodeProjection(document, state);
  const nodes = document.scene.nodes.map((node) => {
    const transform = projected.get(node.id)!.transform;
    return {
      id: node.id,
      position: [...transform.position] as PreviewVector3,
      rotation: [...transform.rotation] as PreviewQuaternion,
      scale: [...transform.scale] as PreviewVector3,
    };
  });
  const quads = new Map<string, PreviewFrame["quads"][number]>(
    document.scene.quads.map((quad) => [quad.id, { id: quad.id, visible: false, opacity: 0 }]),
  );
  for (const [surfaceId, compiled] of Object.entries(document.artifacts.renderBundle.surfaces)) {
    const surface = document.artifacts.definition.scene.surfaces[surfaceId]!;
    const host = projected.get(surface.hostNodeId)!;
    const activeStateId = state.surfaces[surfaceId];
    const transition = state.activeRuns.find(
      (run) => run.kind === "surfaceTransition" && run.surfaceId === surfaceId,
    );
    let fade = 1;
    if (transition?.kind === "surfaceTransition") {
      const elapsed = state.runtimeTimeMilliseconds - transition.startedAtRuntimeTimeMilliseconds;
      fade = evaluateTimelineTrack(
        {
          target: { nodeId: surface.hostNodeId, property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: transition.easing },
            { timeMilliseconds: transition.durationMilliseconds, value: 1 },
          ],
        },
        transition.durationMilliseconds,
        elapsed,
      ) as number;
    }
    for (const renderSurface of Object.values(compiled.renderSurfaces)) {
      const quadForState = (stateId: string | undefined) => {
        if (!stateId) return undefined;
        const binding = renderSurface.stateBindings[stateId];
        if (binding?.kind !== "artifacts") return undefined;
        const artifactId = binding.artifactIds[0];
        if (!artifactId) return undefined;
        return quads.get(previewQuadId(surfaceId, renderSurface.id, artifactId, stateId));
      };
      const hostOpacity = host.active ? host.opacity : 0;
      if (transition?.kind === "surfaceTransition") {
        const outgoing = quadForState(transition.fromStateId);
        const incoming = quadForState(transition.toStateId);
        if (outgoing && incoming) {
          const incomingBinding = renderSurface.stateBindings[transition.toStateId];
          if (incomingBinding?.kind !== "artifacts") throw new Error("Invalid baked binding.");
          const incomingArtifact = renderSurface.artifacts[incomingBinding.artifactIds[0]!];
          if (incomingArtifact?.kind !== "baked-web") throw new Error("Invalid baked artifact.");
          outgoing.opacity = hostOpacity;
          outgoing.visible = hostOpacity > 0;
          outgoing.blendTextureId = incomingArtifact.states[transition.toStateId]!.texture.assetId;
          outgoing.blendWeight = fade;
        } else if (outgoing) {
          outgoing.opacity = hostOpacity * (1 - fade);
          outgoing.visible = outgoing.opacity > 0;
        } else if (incoming) {
          incoming.opacity = hostOpacity * fade;
          incoming.visible = incoming.opacity > 0;
        }
      } else {
        const current = quadForState(activeStateId);
        if (current) {
          current.opacity = hostOpacity;
          current.visible = hostOpacity > 0;
        }
      }
    }
  }
  return { generation, nodes, quads: [...quads.values()] };
}
