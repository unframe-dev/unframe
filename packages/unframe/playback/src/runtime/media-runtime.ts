import type { CanonicalRuntimeSnapshot } from "@unframe/contracts/presentation/runtime-projection";
import type { PresentationDefinition } from "@unframe/contracts/presentation/definition";
import type { RenderBundle } from "@unframe/contracts/presentation/render-bundle";
import type { CueState, RuntimeRun, RuntimeRunCause, RuntimeRunId } from "./cue-executor.js";

type ModelRun = Extract<RuntimeRun, { kind: "modelClip" }>;
type MediaRun = Extract<RuntimeRun, { kind: "media" }>;
type Clip = Extract<ModelRun["phase"], { kind: "single" }>["clip"];
type Clock = Clip["playback"];
type Action =
  PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number]["actions"][number];
type PlaybackAction = Extract<Action, { kind: `media.${string}` | `modelClip.${string}` }>;
type Held = Extract<
  CanonicalRuntimeSnapshot["modelClipStates"][string],
  { kind: "heldClip" }
>["clip"];

export const initializePlaybackCatalog = (
  definition: PresentationDefinition,
  bundle?: RenderBundle,
) => {
  const media: Record<string, Record<string, { durationMilliseconds: number; loop: boolean }>> = {};
  const models: Record<string, Record<string, number>> = {};
  for (const [id, node] of Object.entries(definition.scene.nodes)) {
    if (node.kind !== "model") continue;
    const model = bundle?.models[node.assetId];
    if (!model) throw new Error(`RenderBundle model catalog is required for ${id}.`);
    models[id] = Object.fromEntries(
      Object.entries(model.clips).map(([clipId, clip]) => [clipId, clip.durationMilliseconds]),
    );
  }
  for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
    const videos =
      surface.content.kind === "structured"
        ? Object.values(surface.content.nodes).filter((node) => node.kind === "video")
        : [];
    const needsCatalog =
      videos.length > 0 || surface.renderIntent.internalAnimation.kind === "precomputed-video";
    if (!needsCatalog) continue;
    const compiled = bundle?.surfaces[id];
    if (!compiled) throw new Error(`RenderBundle Video catalog is required for ${id}.`);
    const states: Record<string, { durationMilliseconds: number; loop: boolean }> = {};
    let canonicalDuration: number | undefined;
    for (const stateId of Object.keys(surface.states)) {
      const video = Object.values(compiled.renderSurfaces).flatMap((render) => {
        const binding = render.stateBindings[stateId];
        return binding?.kind === "artifacts"
          ? binding.artifactIds.flatMap((artifactId) => {
              const artifact = render.artifacts[artifactId];
              return artifact?.kind === "video" ? [artifact] : [];
            })
          : [];
      });
      const first = video[0];
      if (!first) continue;
      if (
        video.some(
          (artifact) =>
            artifact.durationMilliseconds !== first.durationMilliseconds ||
            artifact.loop !== first.loop,
        ) ||
        (canonicalDuration !== undefined && canonicalDuration !== first.durationMilliseconds)
      )
        throw new Error(`Video runtime catalog disagrees for ${id}.`);
      canonicalDuration = first.durationMilliseconds;
      states[stateId] = { durationMilliseconds: first.durationMilliseconds, loop: first.loop };
    }
    media[id] = states;
  }
  for (const durations of Object.values(models))
    for (const duration of Object.values(durations))
      if (!Number.isSafeInteger(duration) || duration <= 0)
        throw new Error("Invalid Model clip duration.");
  for (const spec of Object.values(media).flatMap((states) => Object.values(states)))
    if (!Number.isSafeInteger(spec.durationMilliseconds) || spec.durationMilliseconds <= 0)
      throw new Error("Invalid Media duration.");
  return { media, models };
};
export const initializePlaybackResources = (
  definition: PresentationDefinition,
  state: CueState,
  groupId: string,
  includePresentation: boolean,
) => {
  const active = (owner: { kind: string; groupId?: string }) =>
    owner.kind === "presentation" ? includePresentation : owner.groupId === groupId;
  for (const id of Object.keys(state.playbackCatalog.models))
    if (active(definition.scene.nodes[id]!.owner))
      state.modelClipStates[id] = { kind: "defaultPose" };
  for (const id of Object.keys(state.playbackCatalog.media))
    if (active(definition.scene.nodes[definition.scene.surfaces[id]!.hostNodeId]!.owner))
      state.mediaStates[id] = { kind: "stopped", heldPositionMilliseconds: 0 };
};
const playing = (position: number, now: number): Clock => ({
  kind: "playing",
  positionAtReferenceMilliseconds: position,
  referenceRuntimeTimeMilliseconds: now,
});
const paused = (position: number): Clock => ({ kind: "paused", positionMilliseconds: position });
const rawPosition = (clock: Clock, now: number, speed = 1) =>
  clock.kind === "paused"
    ? clock.positionMilliseconds
    : clock.positionAtReferenceMilliseconds +
      (now - clock.referenceRuntimeTimeMilliseconds) * speed;
export const modelClipPosition = (clip: Clip, duration: number, now: number) => {
  const raw = rawPosition(clip.playback, now, clip.speed);
  if (!clip.loop) return Math.min(duration, raw);
  if (raw === Infinity && clip.playback.kind === "playing") {
    // Logical clock deltas are integer milliseconds, so speed can be reduced before multiplication.
    const elapsed = now - clip.playback.referenceRuntimeTimeMilliseconds;
    return (
      ((clip.playback.positionAtReferenceMilliseconds % duration) +
        ((elapsed * (clip.speed % duration)) % duration)) %
      duration
    );
  }
  return raw % duration;
};
const held = (state: CueState, id: string, clip: Clip): Held => ({
  clipId: clip.clipId,
  positionMilliseconds: modelClipPosition(
    clip,
    state.playbackCatalog.models[id]![clip.clipId]!,
    state.runtimeTimeMilliseconds,
  ),
});
const deadlineValue = (clock: Clock, duration: number, speed = 1): number =>
  clock.kind === "paused"
    ? Infinity
    : clock.referenceRuntimeTimeMilliseconds +
      Math.ceil(Math.max(0, duration - clock.positionAtReferenceMilliseconds) / speed);
const deadline = (clock: Clock, duration: number, speed = 1): number => {
  const result = deadlineValue(clock, duration, speed);
  if (clock.kind === "paused") return result;
  if (!Number.isSafeInteger(result))
    throw new RangeError("Logical playback deadline exceeds the safe integer range.");
  return result;
};
const hasSafeClipDeadline = (clip: Clip, duration: number): boolean =>
  clip.loop ||
  clip.playback.kind === "paused" ||
  Number.isSafeInteger(deadlineValue(clip.playback, duration, clip.speed));
export const playbackDeadline = (state: CueState, run: ModelRun | MediaRun): number => {
  if (run.kind === "media") {
    const spec = state.playbackCatalog.media[run.surfaceId]![state.surfaces[run.surfaceId]!]!;
    return spec.loop ? Infinity : deadline(run.playback, spec.durationMilliseconds);
  }
  if (run.phase.kind === "crossfade")
    return deadline(
      run.phase.transition.transitionClock,
      run.phase.transition.durationMilliseconds,
    );
  const clip = run.phase.clip;
  return clip.loop
    ? Infinity
    : Math.max(
        state.runtimeTimeMilliseconds,
        deadline(
          clip.playback,
          state.playbackCatalog.models[run.modelNodeId]![clip.clipId]!,
          clip.speed,
        ),
      );
};
const eased = (u: number, easing: string) =>
  easing === "cubicIn"
    ? u ** 3
    : easing === "cubicOut"
      ? 1 - (1 - u) ** 3
      : easing === "cubicInOut"
        ? u < 0.5
          ? 4 * u ** 3
          : 1 - (-2 * u + 2) ** 3 / 2
        : u;
export const settlePlaybackRun = (
  state: CueState,
  run: ModelRun | MediaRun,
  completed: boolean,
) => {
  if (run.kind === "media") {
    const spec = state.playbackCatalog.media[run.surfaceId]![state.surfaces[run.surfaceId]!]!;
    const raw = rawPosition(run.playback, state.runtimeTimeMilliseconds);
    state.mediaStates[run.surfaceId] = {
      kind: "stopped",
      heldPositionMilliseconds: completed
        ? 0
        : spec.loop
          ? raw % spec.durationMilliseconds
          : Math.min(spec.durationMilliseconds, raw),
    };
  } else if (run.phase.kind === "single")
    state.modelClipStates[run.modelNodeId] = {
      kind: "heldClip",
      clip: held(state, run.modelNodeId, run.phase.clip),
    };
  else {
    const fade = run.phase.transition;
    state.modelClipStates[run.modelNodeId] = {
      kind: "heldBlend",
      from: held(state, run.modelNodeId, fade.from),
      to: held(state, run.modelNodeId, fade.to),
      toWeight: eased(
        Math.max(
          0,
          Math.min(
            1,
            rawPosition(fade.transitionClock, state.runtimeTimeMilliseconds) /
              fade.durationMilliseconds,
          ),
        ),
        fade.easing,
      ),
    };
  }
};

export const applyPlaybackAction = (
  definition: PresentationDefinition,
  state: CueState,
  action: PlaybackAction,
  cause: RuntimeRunCause,
  resolve: (value: Extract<Action, { kind: "media.seek" }>["positionSeconds"]) => unknown,
  allocate: (state: CueState) => RuntimeRunId,
): "invalidTarget" | "invalidActionValue" | "conflict" | undefined => {
  const now = state.runtimeTimeMilliseconds;
  if ("surfaceId" in action) {
    const id = action.surfaceId;
    const spec = state.playbackCatalog.media[id]?.[state.surfaces[id]!];
    const current = state.mediaStates[id];
    if (!spec || !current) return "invalidTarget";
    if (
      state.activeRuns.some(
        (candidate) => candidate.kind === "surfaceTransition" && candidate.surfaceId === id,
      )
    )
      return "conflict";
    let run = state.activeRuns.find(
      (candidate): candidate is MediaRun =>
        candidate.kind === "media" && candidate.surfaceId === id,
    );
    let pos =
      current.kind === "stopped"
        ? current.heldPositionMilliseconds
        : rawPosition(current.playback, now);
    if (current.kind === "active")
      pos = spec.loop ? pos % spec.durationMilliseconds : Math.min(pos, spec.durationMilliseconds);
    let clock: Clock;
    if (action.kind === "media.pause") {
      if (!run) return "invalidActionValue";
      clock = paused(pos);
    } else if (action.kind === "media.seek") {
      const seconds = resolve(action.positionSeconds);
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        seconds * 1000 > spec.durationMilliseconds
      )
        return "invalidActionValue";
      pos = seconds * 1000;
      if (!run) {
        state.mediaStates[id] = { kind: "stopped", heldPositionMilliseconds: pos };
        return;
      }
      clock = run.playback.kind === "paused" ? paused(pos) : playing(pos, now);
    } else {
      if (run?.playback.kind === "playing") return;
      clock = playing(pos, now);
    }
    if (
      !spec.loop &&
      clock.kind === "playing" &&
      !Number.isSafeInteger(deadlineValue(clock, spec.durationMilliseconds))
    )
      return "invalidActionValue";
    if (!run) {
      const host = definition.scene.nodes[definition.scene.surfaces[id]!.hostNodeId]!;
      run = {
        kind: "media",
        surfaceId: id,
        playback: clock,
        runId: allocate(state),
        owner:
          host.owner.kind === "presentation"
            ? { kind: "presentation" }
            : { ...host.owner, groupEntryEpoch: state.groupEntryEpoch },
        cause,
        completion: "nonBlocking",
        startedAtRuntimeTimeMilliseconds: now,
      };
      state.activeRuns.push(run);
    } else run.playback = clock;
    playbackDeadline(state, run);
    state.mediaStates[id] = {
      kind: "active",
      runId: run.runId,
      playback: JSON.parse(JSON.stringify(clock)) as Clock,
    };
    return;
  }
  const id = action.nodeId;
  const durations = state.playbackCatalog.models[id];
  const current = state.modelClipStates[id];
  if (!durations || !current) return "invalidTarget";
  const run = state.activeRuns.find(
    (candidate): candidate is ModelRun =>
      candidate.kind === "modelClip" && candidate.modelNodeId === id,
  );
  if (action.kind === "modelClip.stop") {
    if (run) {
      settlePlaybackRun(state, run, false);
      state.activeRuns = state.activeRuns.filter((candidate) => candidate !== run);
    }
    return;
  }
  if (action.kind === "modelClip.pause" || action.kind === "modelClip.resume") {
    if (!run) return "invalidActionValue";
    const pause = action.kind === "modelClip.pause";
    const rebase = (clock: Clock, pos: number): Clock =>
      (clock.kind === "paused") === pause ? clock : pause ? paused(pos) : playing(pos, now);
    const rebaseClip = (clip: Clip) => {
      clip.playback = rebase(clip.playback, modelClipPosition(clip, durations[clip.clipId]!, now));
    };
    if (run.phase.kind === "single") {
      rebaseClip(run.phase.clip);
      if (!hasSafeClipDeadline(run.phase.clip, durations[run.phase.clip.clipId]!))
        return "invalidActionValue";
    } else {
      const fade = run.phase.transition;
      if (!fade.fromIsHeld) rebaseClip(fade.from);
      rebaseClip(fade.to);
      fade.transitionClock = rebase(fade.transitionClock, rawPosition(fade.transitionClock, now));
      if (
        !hasSafeClipDeadline(fade.to, durations[fade.to.clipId]!) ||
        (fade.transitionClock.kind === "playing" &&
          !Number.isSafeInteger(deadlineValue(fade.transitionClock, fade.durationMilliseconds)))
      )
        return "invalidActionValue";
    }
    return;
  }
  if (action.kind !== "modelClip.play") return "invalidTarget";
  if (
    !durations[action.clipId] ||
    !Number.isFinite(action.speed) ||
    action.speed <= 0 ||
    (action.loop && action.completion === "blocking")
  )
    return "invalidActionValue";
  if (run?.phase.kind === "crossfade") return "conflict";
  const clip: Clip = {
    clipId: action.clipId,
    playback: playing(0, now),
    speed: action.speed,
    loop: action.loop,
  };
  if (!hasSafeClipDeadline(clip, durations[clip.clipId]!)) return "invalidActionValue";
  let phase: ModelRun["phase"] = { kind: "single", clip };
  if (action.transition.kind === "crossfade") {
    if (!Number.isSafeInteger(now + action.transition.durationMilliseconds))
      return "invalidActionValue";
    if (current.kind === "defaultPose" || current.kind === "heldBlend") return "conflict";
    const from =
      current.kind === "heldClip"
        ? {
            clipId: current.clip.clipId,
            playback: paused(current.clip.positionMilliseconds),
            speed: 1,
            loop: false,
          }
        : run?.phase.kind === "single"
          ? run.phase.clip
          : undefined;
    if (!from) return "invalidActionValue";
    phase = {
      kind: "crossfade",
      transition: {
        durationMilliseconds: action.transition.durationMilliseconds,
        easing: action.transition.easing,
        from,
        to: clip,
        transitionClock: playing(0, now),
        fromIsHeld: current.kind === "heldClip",
      },
    };
  }
  const node = definition.scene.nodes[id]!;
  const next: ModelRun = {
    kind: "modelClip",
    modelNodeId: id,
    phase,
    runId: allocate(state),
    owner:
      node.owner.kind === "presentation"
        ? { kind: "presentation" }
        : { ...node.owner, groupEntryEpoch: state.groupEntryEpoch },
    cause,
    completion: action.completion,
    startedAtRuntimeTimeMilliseconds: now,
  };
  playbackDeadline(state, next);
  state.activeRuns = state.activeRuns.filter((candidate) => candidate !== run);
  state.activeRuns.push(next);
  state.modelClipStates[id] = { kind: "active", runId: next.runId };
};
