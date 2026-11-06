import assert from "node:assert/strict";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, executeCueEvent, evaluateTimelineTrack } from "@unframe-dev/playback";
import { definition, initialState } from "./project.mjs";

let sequence = 0;
const input = (state, action = "presenter.next") =>
  executeCueEvent(definition, state, {
    kind: "logicalInput",
    action,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `show-${++sequence}`,
  });
const gesture = (state, recognized) =>
  executeCueEvent(definition, state, {
    kind: "gesture",
    gesture: recognized,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `gesture-${++sequence}`,
  });
const zone = (state, edge = "enter") =>
  executeCueEvent(definition, state, {
    kind: "zoneEdge",
    zoneId: "journey-stage",
    edge,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `zone-${++sequence}`,
  });
test("Zoneに入って枠を表示し、両手を広げると内容が空間へ広がる", () => {
  const waiting = tick(gesture(expression(), "swipeLeft").state, 801);
  assert.equal(waiting.currentStepId, "journey-zone");
  assert.equal(gesture(waiting, "spreadHands").outcome.kind, "none");
  assert.equal(zone(waiting, "exit").outcome.kind, "none");
  assert.equal(input(waiting).outcome.kind, "none");
  assert.deepEqual(definition.stage.zones["journey-stage"].center, [-1.8, 0, 0]);
  const entered = zone(waiting).state;
  assert.equal(zone(entered).outcome.kind, "none");
  const entering = tick(entered, 401);
  const timeline = definition.flow.timelines[entering.activeRuns[0].timelineId];
  const titleId = reactResourceId("host", "goal-before");
  const rise = timeline.tracks.find(
    (track) => track.target.nodeId === titleId && track.target.property === "transform.position",
  );
  const fade = timeline.tracks.find(
    (track) => track.target.nodeId === titleId && track.target.property === "opacity",
  );
  assert.ok(rise);
  assert.ok(fade);
  assert.deepEqual(evaluateTimelineTrack(rise, 800, 0), [-0.35, 1.5, 0.35]);
  const midway = evaluateTimelineTrack(rise, 800, 400);
  assert.ok(midway[1] > 1.5 && midway[1] < 1.7);
  const opacity = evaluateTimelineTrack(fade, 800, 400);
  assert.ok(opacity > 0 && opacity < 1);
  const framed = tick(entering, 400);
  assert.deepEqual(node(framed, "goal-before").transform.position, [-0.35, 1.7, 0.35]);
  assert.equal(framed.currentStepId, "journey-framed");
  assert.equal(node(framed, "goal-frame-left").opacity, 1);
  assert.equal(node(framed, "goal-after").opacity, 0);
  const expanding = tick(gesture(framed, "spreadHands").state, 1);
  const expansion = definition.flow.timelines[expanding.activeRuns[0].timelineId];
  const sample = (id, property, time) => {
    const track = expansion.tracks.find(
      (track) =>
        track.target.nodeId === reactResourceId("host", id) && track.target.property === property,
    );
    assert.ok(track);
    return evaluateTimelineTrack(track, expansion.durationMilliseconds, time);
  };
  assert.equal(expansion.durationMilliseconds, 2200);
  assert.ok(sample("goal-before", "opacity", 150) < 1);
  for (const time of [0, 150, 300]) {
    assert.deepEqual(sample("goal-cube", "transform.position", time), [0.55, 1.3, 0.35]);
    assert.deepEqual(sample("goal-frame-left", "transform.position", time), [-0.6, 1.4, 0.3]);
    assert.deepEqual(sample("goal-frame-right", "transform.position", time), [0.6, 1.4, 0.3]);
  }
  for (const time of [300, 900, 1500, 1850, 2200]) {
    assert.equal(sample("goal-before", "opacity", time), 0);
  }
  for (const time of [0, 150, 300, 900, 1500]) {
    assert.equal(sample("goal-after", "opacity", time), 0);
  }
  assert.ok(sample("goal-cube", "transform.position", 900)[2] < 0.35);
  assert.deepEqual(sample("goal-cube", "transform.position", 1500), [0.85, 1.35, 0]);
  assert.ok(sample("goal-after", "opacity", 1850) > 0);
  assert.ok(sample("goal-after", "opacity", 1850) < 1);
  assert.equal(tick(expanding, 1500).currentStepId, "journey-goal");
  const expanded = tick(expanding, 2200);
  assert.equal(node(expanded, "goal-before").opacity, 0);
  assert.equal(expanded.currentStepId, "journey-goal-ready");
  assert.equal(node(expanded, "goal-frame-left").opacity, 0);
  assert.equal(node(expanded, "goal-after").opacity, 1);
  assert.ok(
    node(expanded, "goal-cube").transform.position[2] <
      node(framed, "goal-cube").transform.position[2],
  );
  assert.equal(input(expanded).outcome.kind, "none");
  assert.equal(gesture(expanded, "pushForward").outcome.kind, "none");
  const pulled = gesture(expanded, "pullBackward");
  assert.equal(pulled.outcome.kind, "accepted");
  assert.equal(gesture(pulled.state, "pullBackward").outcome.kind, "none");
  assert.equal(input(pulled.state).outcome.kind, "none");
  const retreating = tick(pulled.state, 501);
  assert.equal(retreating.currentGroupId, "journey");
  const exitTimeline = definition.flow.timelines[retreating.activeRuns[0].timelineId];
  const messageId = reactResourceId("host", "goal-after");
  const trackFor = (property) =>
    exitTimeline.tracks.find(
      (track) => track.target.nodeId === messageId && track.target.property === property,
    );
  const position = trackFor("transform.position");
  const scale = trackFor("transform.scale");
  const opacityTrack = trackFor("opacity");
  assert.ok(position);
  assert.ok(scale);
  assert.ok(opacityTrack);
  assert.deepEqual(evaluateTimelineTrack(position, 1000, 0), [0, 1.6, 0.5]);
  const halfwayPosition = evaluateTimelineTrack(position, 1000, 500);
  assert.equal(halfwayPosition[0], 0);
  assert.equal(halfwayPosition[1], 1.6);
  assert.ok(halfwayPosition[2] < 0.5);
  const halfwayScale = evaluateTimelineTrack(scale, 1000, 500);
  assert.ok(halfwayScale.every((value) => value > 0.2 && value < 1));
  const halfwayOpacity = evaluateTimelineTrack(opacityTrack, 1000, 500);
  assert.ok(halfwayOpacity > 0 && halfwayOpacity < 1);
  assert.equal(evaluateTimelineTrack(opacityTrack, 1000, 1000), 0);
  const cubePosition = exitTimeline.tracks.find(
    (track) =>
      track.target.nodeId === reactResourceId("host", "goal-cube") &&
      track.target.property === "transform.position",
  );
  const cubeScale = exitTimeline.tracks.find(
    (track) =>
      track.target.nodeId === reactResourceId("host", "goal-cube") &&
      track.target.property === "transform.scale",
  );
  const cubeOpacity = exitTimeline.tracks.find(
    (track) =>
      track.target.nodeId === reactResourceId("host", "goal-cube") &&
      track.target.property === "opacity",
  );
  assert.ok(cubePosition);
  assert.ok(cubeScale);
  assert.ok(cubeOpacity);
  assert.deepEqual(evaluateTimelineTrack(cubePosition, 1000, 0), [0.85, 1.35, 0]);
  assert.deepEqual(evaluateTimelineTrack(cubeScale, 1000, 0), [0.24, 0.24, 0.24]);
  for (const time of [0, 250, 500, 750, 1000]) {
    const textPosition = evaluateTimelineTrack(position, 1000, time);
    const modelPosition = evaluateTimelineTrack(cubePosition, 1000, time);
    assert.ok(Math.abs(modelPosition[2] - (textPosition[2] - 0.5)) < 1e-12);
    assert.ok(
      Math.abs(
        evaluateTimelineTrack(cubeScale, 1000, time)[0] / 0.24 -
          evaluateTimelineTrack(scale, 1000, time)[0],
      ) < 1e-12,
    );
    assert.equal(
      evaluateTimelineTrack(cubeOpacity, 1000, time),
      evaluateTimelineTrack(opacityTrack, 1000, time),
    );
  }
  const conditions = tick(retreating, 500);
  assert.equal(conditions.currentGroupId, "poc-history");
  assert.equal(node(conditions, "goal-cube"), undefined);
});
const tick = (state, elapsed) =>
  advanceCueClock(definition, state, state.runtimeTimeMilliseconds + elapsed).state;
const dismissed = () => {
  let state = advanceCueClock(definition, input(initialState()).state, 6001).state;
  state = input(state).state;
  state = advanceCueClock(definition, state, 9362).state;
  state = input(state).state;
  state = input(state).state;
  state = advanceCueClock(definition, state, 19362).state;
  state = input(state).state;
  return advanceCueClock(definition, state, 21483).state;
};
const node = (state, id) => state.nodes[reactResourceId("host", id)];

test("手の光は次へを待ち、待機中の円では進まない", () => {
  const waiting = tick(input(dismissed()).state, 60002);
  assert.equal(waiting.effectRuns.length, 0);
  assert.equal(gesture(waiting, "circle").outcome.kind, "none");
  const started = tick(input(waiting).state, 1);
  assert.equal(started.effectRuns.length, 2);
  assert.equal(input(started).outcome.kind, "none");
});

test("円の認識前から軌跡を表示し、円と投げる動作で進む", () => {
  const waiting = tick(input(input(dismissed()).state).state, 1);
  assert.equal(waiting.currentStepId, "expression");
  assert.equal(node(waiting, "expression-cube").opacity, 0);
  assert.equal(waiting.effectRuns.length, 2);
  for (const hand of ["left", "right"]) {
    assert.ok(
      waiting.effectRuns.some((run) => run.effect.kind === "handGlow" && run.effect.hand === hand),
    );
    const parent =
      definition.scene.nodes[reactResourceId("host", `expression-${hand}-hand`)].parent;
    assert.equal(parent.kind, "anchor");
    assert.equal(parent.owner.kind, "presenter");
    assert.equal(parent.target, `${hand}Hand`);
    assert.equal(parent.followPosition, true);
    assert.equal(parent.followRotation, false);
  }
  assert.equal(input(waiting).outcome.kind, "none");
  assert.equal(gesture(waiting, "throw").outcome.kind, "none");
  const drawing = gesture(waiting, "circle");
  assert.equal(drawing.outcome.kind, "accepted");
  assert.equal(drawing.state.effectRuns.length, 0);
  assert.equal(gesture(drawing.state, "circle").outcome.kind, "none");
  const drawn = tick(drawing.state, 801);
  assert.equal(drawn.currentStepId, "expression-drawn");
  assert.equal(node(drawn, "expression-cube").opacity, 1);
  assert.equal(node(drawn, "expression-message").opacity, 0);
  assert.equal(input(drawn).outcome.kind, "none");
  assert.equal(gesture(drawn, "circle").outcome.kind, "none");
  const moving = gesture(drawn, "throw");
  assert.equal(moving.outcome.kind, "accepted");
  assert.equal(gesture(moving.state, "throw").outcome.kind, "none");
  const halfway = tick(moving.state, 551);
  assert.equal(node(halfway, "expression-message").opacity, 0);
  const moveTimeline = definition.flow.timelines[halfway.activeRuns[0].timelineId];
  const positionTrack = moveTimeline.tracks.find(
    (track) => track.target.property === "transform.position",
  );
  const midwayPosition = evaluateTimelineTrack(
    positionTrack,
    moveTimeline.durationMilliseconds,
    550,
  );
  assert.ok(midwayPosition[0] < 0);
  assert.ok(midwayPosition[1] > 1.3);
  assert.equal(input(halfway).outcome.kind, "none");
  const moved = tick(halfway, 550);
  assert.equal(moved.currentStepId, "expression-message");
  assert.deepEqual(node(moved, "expression-cube").transform.position, [-1.2, 2.2, 1]);
  assert.equal(node(moved, "expression-message").opacity, 0);
  const showing = tick(moved, 351);
  const messageTimeline = definition.flow.timelines[showing.activeRuns[0].timelineId];
  const opacity = evaluateTimelineTrack(
    messageTimeline.tracks[0],
    messageTimeline.durationMilliseconds,
    350,
  );
  assert.ok(opacity > 0 && opacity < 1);
  const riseTrack = messageTimeline.tracks.find(
    (track) => track.target.property === "transform.position",
  );
  assert.ok(riseTrack);
  assert.deepEqual(evaluateTimelineTrack(riseTrack, 700, 0), [-1.2, 1.3, 1]);
  const risingPosition = evaluateTimelineTrack(riseTrack, 700, 350);
  assert.equal(risingPosition[0], -1.2);
  assert.equal(risingPosition[2], 1);
  assert.ok(risingPosition[1] > 1.3 && risingPosition[1] < 1.5);
  assert.deepEqual(evaluateTimelineTrack(riseTrack, 700, 700), [-1.2, 1.5, 1]);
  assert.deepEqual(
    node(showing, "expression-cube").transform,
    node(moved, "expression-cube").transform,
  );
  assert.equal(input(showing).outcome.kind, "none");
  const ready = tick(showing, 350);
  assert.equal(ready.currentStepId, "expression-ready");
  assert.equal(node(ready, "expression-message").opacity, 1);
  const cubePosition = node(ready, "expression-cube").transform.position;
  const messagePosition = node(ready, "expression-message").transform.position;
  assert.equal(messagePosition[0], cubePosition[0]);
  assert.equal(messagePosition[2], cubePosition[2]);
  assert.equal(messagePosition[1], 1.5);
  assert.equal(input(ready).outcome.kind, "none");
  assert.equal(gesture(ready, "swipeRight").outcome.kind, "none");
  const dismissing = gesture(ready, "swipeLeft");
  assert.equal(dismissing.outcome.kind, "accepted");
  assert.equal(gesture(dismissing.state, "swipeLeft").outcome.kind, "none");
  assert.equal(input(dismissing.state).outcome.kind, "none");
  const fading = tick(dismissing.state, 401);
  assert.equal(fading.currentGroupId, "expression");
  const exitTimeline = definition.flow.timelines[fading.activeRuns[0].timelineId];
  for (const id of ["expression-cube", "expression-message"]) {
    const nodeId = reactResourceId("host", id);
    const position = exitTimeline.tracks.find(
      (track) => track.target.nodeId === nodeId && track.target.property === "transform.position",
    );
    const opacity = exitTimeline.tracks.find(
      (track) => track.target.nodeId === nodeId && track.target.property === "opacity",
    );
    const startPosition = node(ready, id).transform.position;
    assert.deepEqual(evaluateTimelineTrack(position, 800, 0), startPosition);
    const halfwayPosition = evaluateTimelineTrack(position, 800, 400);
    assert.ok(halfwayPosition[0] < startPosition[0]);
    assert.deepEqual(halfwayPosition.slice(1), startPosition.slice(1));
    const halfwayOpacity = evaluateTimelineTrack(opacity, 800, 400);
    assert.ok(halfwayOpacity > 0 && halfwayOpacity < 1);
    assert.equal(evaluateTimelineTrack(opacity, 800, 800), 0);
  }
  const next = tick(fading, 400);
  assert.equal(next.currentStepId, "journey-zone");
  assert.equal(node(next, "expression-message"), undefined);
  assert.equal(node(next, "expression-left-hand"), undefined);
  assert.equal(next.effectRuns.length, 0);
});

test("円を待っている間は軌跡の表示期間を更新して認識待ちを維持する", () => {
  const waiting = tick(input(input(dismissed()).state).state, 60002);
  assert.equal(waiting.currentStepId, "expression");
  assert.equal(waiting.effectRuns.length, 2);
  assert.equal(gesture(waiting, "circle").outcome.kind, "accepted");
});

const expression = () => {
  const waiting = tick(input(input(dismissed()).state).state, 1);
  const drawn = tick(gesture(waiting, "circle").state, 801);
  return tick(gesture(drawn, "throw").state, 1802);
};
const goal = () => {
  const waiting = tick(gesture(expression(), "swipeLeft").state, 801);
  const framed = tick(zone(waiting).state, 801);
  return tick(gesture(framed, "spreadHands").state, 2201);
};

test("PoCの見出しが移動して一覧が現れ、次へで各項目に注目する", () => {
  let state = tick(gesture(goal(), "pullBackward").state, 1001);
  assert.equal(state.currentGroupId, "poc-history");
  assert.equal(input(state).outcome.kind, "none");
  const entering = tick(state, 1);
  const overview = definition.flow.timelines[entering.activeRuns[0].timelineId];
  const position = overview.tracks.find(
    (track) =>
      track.target.nodeId === reactResourceId("host", "poc-heading") &&
      track.target.property === "transform.position",
  );
  assert.deepEqual(evaluateTimelineTrack(position, 3000, 0), [0, 1.6, -1]);
  assert.deepEqual(evaluateTimelineTrack(position, 3000, 700), [0, 1.6, 0]);
  assert.deepEqual(evaluateTimelineTrack(position, 3000, 1000), [0, 1.6, 0]);
  state = tick(state, 1501);
  assert.equal(node(state, "poc-item-1").opacity, 0);
  state = tick(state, 1500);
  assert.equal(state.currentStepId, "poc-overview-ready");
  assert.deepEqual(node(state, "poc-heading").transform.position, [-0.95, 2.25, 0]);
  assert.deepEqual(node(state, "poc-heading").transform.scale, [0.65, 0.65, 0.65]);
  for (const id of ["poc-item-1", "poc-item-2", "poc-item-3", "poc-arrow-1", "poc-arrow-2"]) {
    assert.equal(node(state, id).opacity, 1);
  }
  const exhibits = [
    ["poc-3d-model", "poc-3d-panel"],
    ["poc-ring-1", "poc-ring-2", "poc-ring-3", "poc-ring-4", "poc-ring-5", "poc-ring-6"],
    ["poc-museum-1", "poc-museum-2", "poc-museum-3"],
  ];
  for (const id of exhibits.flat()) assert.equal(node(state, id)?.opacity, 0, id);
  for (let selected = 1; selected <= 3; selected++) {
    assert.equal(gesture(state, "swipeRight").outcome.kind, "none");
    state = input(state).state;
    assert.equal(input(state).outcome.kind, "none");
    const focusing = tick(state, 201);
    const focusTimeline = definition.flow.timelines[focusing.activeRuns[0].timelineId];
    for (const id of [...exhibits[selected - 1], ...(exhibits[selected - 2] ?? [])]) {
      const track = focusTimeline.tracks.find(
        (track) =>
          track.target.nodeId === reactResourceId("host", id) &&
          track.target.property === "opacity",
      );
      assert.ok(track, id);
      assert.equal(evaluateTimelineTrack(track, 400, 0), node(state, id).opacity, id);
      const opacity = evaluateTimelineTrack(track, 400, 200);
      assert.ok(opacity > 0 && opacity < 1, id);
    }
    state = tick(focusing, 200);
    for (const [index, ids] of exhibits.entries()) {
      for (const id of ids)
        assert.equal(node(state, id).opacity, Number(index + 1 === selected), id);
    }
    for (let item = 1; item <= 3; item++) {
      assert.equal(node(state, `poc-item-${item}`).opacity, item === selected ? 1 : 0.25);
      assert.deepEqual(
        node(state, `poc-item-${item}`).transform.scale,
        item === selected ? [1.25, 1.25, 1.25] : [1, 1, 1],
      );
    }
  }
  assert.equal(input(state).outcome.kind, "none");
  assert.equal(gesture(state, "swipeLeft").outcome.kind, "none");
  const exiting = gesture(state, "swipeRight");
  assert.equal(exiting.outcome.kind, "accepted");
  assert.equal(input(exiting.state).outcome.kind, "none");
  assert.equal(gesture(exiting.state, "swipeRight").outcome.kind, "none");
  const halfway = tick(exiting.state, 401);
  assert.equal(halfway.currentGroupId, "poc-history");
  const timeline = definition.flow.timelines[halfway.activeRuns[0].timelineId];
  for (const id of [
    "poc-heading",
    "poc-item-1",
    "poc-item-2",
    "poc-item-3",
    "poc-arrow-1",
    "poc-arrow-2",
    ...exhibits[2],
  ]) {
    const tracks = timeline.tracks.filter(
      (track) => track.target.nodeId === reactResourceId("host", id),
    );
    const position = tracks.find((track) => track.target.property === "transform.position");
    const opacity = tracks.find((track) => track.target.property === "opacity");
    const start = node(state, id);
    assert.deepEqual(evaluateTimelineTrack(position, 800, 0), start.transform.position);
    assert.ok(evaluateTimelineTrack(position, 800, 400)[0] > start.transform.position[0]);
    assert.equal(evaluateTimelineTrack(opacity, 800, 0), start.opacity);
    assert.ok(evaluateTimelineTrack(opacity, 800, 400) < start.opacity);
    assert.ok(evaluateTimelineTrack(opacity, 800, 400) > 0);
    assert.equal(evaluateTimelineTrack(opacity, 800, 800), 0);
  }
  state = tick(halfway, 400);
  assert.equal(state.currentGroupId, "reaction-float");
  assert.equal(node(state, "poc-heading"), undefined);
  for (const id of exhibits.flat()) assert.equal(node(state, id), undefined, id);
});
const afterPoc = () => {
  let state = tick(gesture(goal(), "pullBackward").state, 4002);
  for (let item = 1; item <= 3; item++) state = tick(input(state).state, 401);
  return tick(gesture(state, "swipeRight").state, 801);
};
const reactionZone = (state, edge = "enter") =>
  executeCueEvent(definition, state, {
    kind: "zoneEdge",
    zoneId: "reaction-gaze-stage",
    edge,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `reaction-zone-${++sequence}`,
  });

test("浮遊感を止めて感性を表示し、右Zoneで視線移動を強調して静止・退場する", () => {
  let state = afterPoc();
  assert.equal(state.currentGroupId, "reaction-float");
  assert.equal(gesture(state, "swipeLeft").outcome.kind, "none");
  assert.equal(reactionZone(state).outcome.kind, "none");
  assert.equal(input(state).outcome.kind, "none");
  state = tick(gesture(state, "swipeUp").state, 351);
  const arrival = definition.flow.timelines[state.activeRuns[0].timelineId];
  const incoming = arrival.tracks.find((track) => track.target.property === "transform.position");
  const earlyY = evaluateTimelineTrack(incoming, arrival.durationMilliseconds, 0)[1];
  assert.ok(evaluateTimelineTrack(incoming, arrival.durationMilliseconds, 350)[1] > earlyY);

  state = tick(state, 6650);
  const floatRun = state.activeRuns[0];
  assert.equal(state.currentStepId, "reaction-float-bobbing");
  const bob = definition.flow.timelines[floatRun.timelineId];
  const elapsed = state.runtimeTimeMilliseconds - floatRun.startedAtRuntimeTimeMilliseconds;
  const heldPosition = evaluateTimelineTrack(bob.tracks[0], bob.durationMilliseconds, elapsed);
  assert.notDeepEqual(heldPosition, bob.tracks[0].keyframes[0].value);
  const changed = gesture(state, "swipeLeft");
  assert.equal(changed.outcome.kind, "accepted");
  assert.equal(changed.state.activeRuns.length, 0);
  assert.deepEqual(node(changed.state, "reaction-float-text").transform.position, heldPosition);
  state = tick(changed.state, 701);
  assert.equal(node(state, "reaction-sense-text").opacity, 1);
  assert.deepEqual(node(state, "reaction-float-text").transform.position, heldPosition);
  assert.equal(reactionZone(state, "exit").outcome.kind, "none");
  assert.ok(definition.stage.zones["reaction-gaze-stage"].center[0] > 0);

  state = tick(reactionZone(state).state, 401);
  const zoomRun = state.activeRuns[0];
  assert.equal(state.currentStepId, "reaction-gaze-zoom");
  const zoom = definition.flow.timelines[zoomRun.timelineId];
  const zoomElapsed = state.runtimeTimeMilliseconds - zoomRun.startedAtRuntimeTimeMilliseconds;
  const heldScale = evaluateTimelineTrack(zoom.tracks[0], zoom.durationMilliseconds, zoomElapsed);
  assert.ok(heldScale[0] > zoom.tracks[0].keyframes[0].value[0]);
  assert.ok(heldScale[0] < zoom.tracks[0].keyframes.at(-1).value[0]);
  assert.ok(node(state, "reaction-float-text").opacity < 1);
  assert.ok(node(state, "reaction-sense-text").opacity < 1);
  state = input(state).state;
  assert.equal(state.currentGroupId, "reaction-hold");
  assert.equal(state.activeRuns.length, 0);
  assert.deepEqual(node(state, "reaction-gaze-text").transform.scale, heldScale);

  state = tick(state, 5000);
  assert.deepEqual(node(state, "reaction-gaze-text").transform.scale, heldScale);
  assert.deepEqual(node(state, "reaction-float-text").transform.position, heldPosition);
  state = tick(input(state).state, 301);
  const fade = definition.flow.timelines[state.activeRuns[0].timelineId];
  assert.equal(fade.tracks.length, 3);
  for (const track of fade.tracks) {
    assert.equal(track.target.property, "opacity");
    assert.equal(
      evaluateTimelineTrack(track, fade.durationMilliseconds, 0),
      state.nodes[track.target.nodeId].opacity,
    );
    const opacity = evaluateTimelineTrack(track, fade.durationMilliseconds, 300);
    assert.ok(opacity > 0 && opacity < state.nodes[track.target.nodeId].opacity);
  }
  state = tick(state, 300);
  assert.equal(state.currentGroupId, "closing-wait");
  for (const id of ["reaction-float-text", "reaction-sense-text", "reaction-gaze-text"]) {
    assert.equal(node(state, id).opacity, 0);
  }
});

test("反応の実演後は左Zoneを待ち、中央のブランド表示で閉幕する", () => {
  let state = tick(gesture(afterPoc(), "swipeUp").state, 701);
  state = tick(gesture(state, "swipeLeft").state, 701);
  state = tick(reactionZone(state).state, 1001);
  state = input(state).state;
  state = tick(input(state).state, 601);
  assert.equal(state.currentGroupId, "closing-wait");
  assert.equal(state.activeRuns.length, 0);
  assert.equal(node(state, "brand").opacity, 0);
  assert.equal(input(state).outcome.kind, "none");
  assert.deepEqual(definition.stage.zones["closing-stage"].center, [-1.8, 0, 0]);
  const closingZone = (current, edge = "enter") =>
    executeCueEvent(definition, current, {
      kind: "zoneEdge",
      zoneId: "closing-stage",
      edge,
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: `closing-${++sequence}`,
    });
  assert.equal(closingZone(state, "exit").outcome.kind, "none");
  state = closingZone(state).state;
  assert.equal(state.currentGroupId, "closing");
  assert.equal(input(state).outcome.kind, "none");
  state = tick(state, 1001);
  assert.equal(state.ended, false);
  const timeline = definition.flow.timelines[state.activeRuns[0].timelineId];
  const opacity = timeline.tracks.find((track) => track.target.property === "opacity");
  assert.ok(evaluateTimelineTrack(opacity, 2000, 1000) > 0);
  assert.ok(evaluateTimelineTrack(opacity, 2000, 1000) < 1);
  state = tick(state, 1000);
  assert.equal(state.ended, true);
  assert.equal(node(state, "brand").opacity, 1);
  assert.deepEqual(node(state, "brand").transform.position, [0, 1.6, 0.5]);
  assert.equal(node(state, "logo").opacity, 0);
});

test("削除した説明とまとめの場面・文言を含めない", () => {
  const texts = Object.values(definition.scene.surfaces).flatMap((surface) =>
    Object.values(surface.baseSemanticTree.nodes).map((node) => node.text ?? ""),
  );
  for (const text of [
    "見せる内容",
    "発表者の操作",
    "空間の位置合わせ",
    "観客への共有",
    "動作に応じて、内容が変わる",
    "立つ場所に応じて、場面が変わる",
    "どこに表示するか",
    "いま何が起きているか",
    "観客に伝える。",
  ]) {
    assert.ok(!texts.some((value) => value.includes(text)), text);
  }
  for (const group of ["conditions", "content-action", "space-sharing", "summary"]) {
    assert.equal(definition.flow.groups[group], undefined);
  }
  assert.equal(definition.flow.groups.technology, undefined);
  assert.equal(definition.flow.groups.comparison, undefined);
  assert.equal(node(goal(), "challenge-cube-center"), undefined);
  for (const text of texts)
    assert.doesNotMatch(
      text,
      /Control Plane|Realtime|Workers|試す → 見る → 直す|つくる|そろえる|届ける/,
    );
});
