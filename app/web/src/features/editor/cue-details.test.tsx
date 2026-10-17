import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { FlowCue } from "./model/timeline-view";
import { CueDetails } from "./cue-details";

it("keeps all action parameters visible and distinguishes immediate updates, crossfades, stopping and completion", () => {
  const cue: FlowCue = {
    id: "inspect",
    priority: 2,
    order: 3,
    trigger: { kind: "timelineCompleted", timelineId: "focus" },
    fixedPayload: { reason: "finished" },
    firePolicy: { kind: "repeatable", cooldownMilliseconds: 120 },
    actions: [
      {
        kind: "surface.setState",
        surfaceId: "screen",
        stateId: "summary",
        transition: {
          kind: "crossfade",
          durationMilliseconds: 400,
          easing: "cubicOut",
          completion: "blocking",
        },
      },
      {
        kind: "surface.setState",
        surfaceId: "screen",
        stateId: "cover",
        transition: { kind: "cut" },
      },
      { kind: "node.patch", nodeId: "model", patch: { opacity: { kind: "literal", value: 0.4 } } },
      { kind: "variable.set", variableId: "counter", value: { kind: "literal", value: 7 } },
      { kind: "timeline.play", timelineId: "focus", completion: "blocking", conflict: "reject" },
      { kind: "timeline.stop", timelineId: "fade" },
      { kind: "media.play", surfaceId: "video" },
      { kind: "media.pause", surfaceId: "video" },
      { kind: "media.seek", surfaceId: "video", positionSeconds: { kind: "literal", value: 1.5 } },
      {
        kind: "modelClip.play",
        nodeId: "model",
        clipId: "wave",
        speed: 2,
        loop: true,
        completion: "nonBlocking",
        transition: { kind: "crossfade", durationMilliseconds: 250, easing: "linear" },
        conflict: "reject",
      },
      { kind: "modelClip.pause", nodeId: "model" },
      { kind: "modelClip.resume", nodeId: "model" },
      { kind: "modelClip.stop", nodeId: "model" },
    ],
    next: { kind: "group", groupId: "finale" },
  };
  render(
    <CueDetails cue={cue} destination={{ kind: "group", groupId: "finale", stepId: "closing" }} />,
  );
  expect(
    screen.getByText("Timeline focus の完了を待つ依存関係（発火時刻は未確定）"),
  ).toBeInTheDocument();
  expect(screen.getByText(/"cooldownMilliseconds": 120/)).toBeInTheDocument();
  expect(screen.getByText(/"reason": "finished"/)).toBeInTheDocument();
  expect(screen.getByText("Group finale / 初期 Step closing")).toBeInTheDocument();
  const actions = screen.getByRole("list", { name: "Actions" });
  expect(within(actions).getAllByRole("listitem")).toHaveLength(13);
  expect(
    within(actions).getByText("crossfade による State 遷移（即時更新ではありません）"),
  ).toBeInTheDocument();
  expect(within(actions).getByText("即時の State 更新")).toBeInTheDocument();
  expect(within(actions).getByText("即時の Node 更新")).toBeInTheDocument();
  expect(within(actions).getByText("即時の Variable 更新")).toBeInTheDocument();
  expect(within(actions).getByText("Timeline fade を停止する action")).toBeInTheDocument();
  expect(within(actions).getByText(/"value": 1.5/)).toBeInTheDocument();
  const clip = within(actions).getByRole("heading", { name: "modelClip.play" }).closest("li");
  expect(clip).toHaveTextContent('"speed": 2');
  expect(clip).toHaveTextContent('"loop": true');
  expect(clip).toHaveTextContent('"durationMilliseconds": 250');
  expect(clip).toHaveTextContent('"completion": "nonBlocking"');
  expect(clip).toHaveTextContent('"conflict": "reject"');
});
