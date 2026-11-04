import { useState } from "react";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
import type { PreviewPlaybackResponse } from "@unframe-dev/contracts/author-http";

type Gesture = NonNullable<PreviewPlaybackResponse["simulation"]>["gestures"][number];
const gestureLabels: Record<Gesture, string> = {
  swipeLeft: "左へスワイプ",
  swipeRight: "右へスワイプ",
  swipeUp: "上へスワイプ",
  swipeDown: "下へスワイプ",
  pushForward: "前へ押す",
  pullBackward: "手前へ引く",
  spreadHands: "両手を広げる",
  closeHands: "両手を閉じる",
};

export function SimulationControls() {
  const workspace = useWorkspace();
  const { playback, status } = useStore(workspace.preview.store);
  const [gesture, setGesture] = useState<Gesture | "">("");
  const [eventKey, setEventKey] = useState("");
  const [stepKey, setStepKey] = useState("");
  const simulation = playback?.simulation;
  if (!simulation || playback.mode !== "normal") return null;
  const ready = status === "ready";
  const selectedGesture =
    simulation.gestures.find((item) => item === gesture) ?? simulation.gestures[0];
  const selectedEvent =
    simulation.events.find((item) => JSON.stringify(item) === eventKey) ?? simulation.events[0];
  const selectedStep =
    simulation.steps.find((item) => JSON.stringify(item) === stepKey) ??
    simulation.steps.find(
      (item) => item.groupId === playback.groupId && item.stepId === playback.stepId,
    ) ??
    simulation.steps[0];
  return (
    <div className="simulation-controls" role="toolbar" aria-label="リハーサル入力">
      {selectedStep && (
        <div className="simulation-input">
          <select
            aria-label="リハーサル開始 Step"
            disabled={!ready}
            value={JSON.stringify(selectedStep)}
            onChange={(event) => setStepKey(event.target.value)}
          >
            {simulation.steps.map((item) => (
              <option key={JSON.stringify(item)} value={JSON.stringify(item)}>
                {item.groupId} / {item.stepId}
              </option>
            ))}
          </select>
          <Button
            disabled={!ready}
            onClick={() => workspace.commands.playback({ command: "selectStep", ...selectedStep })}
          >
            Step へ移動
          </Button>
        </div>
      )}
      {selectedGesture && (
        <div className="simulation-input">
          <select
            aria-label="Gesture の種類"
            disabled={!ready}
            value={selectedGesture}
            onChange={(event) => setGesture(event.target.value as Gesture)}
          >
            {simulation.gestures.map((item) => (
              <option key={item} value={item}>
                {gestureLabels[item]}
              </option>
            ))}
          </select>
          <Button
            disabled={!ready}
            onClick={() =>
              workspace.commands.playback({ command: "gesture", gesture: selectedGesture })
            }
          >
            Gesture を送信
          </Button>
        </div>
      )}
      {selectedEvent && (
        <div className="simulation-input">
          <select
            aria-label="外部イベント"
            disabled={!ready}
            value={JSON.stringify(selectedEvent)}
            onChange={(event) => setEventKey(event.target.value)}
          >
            {simulation.events.map((item) => (
              <option key={JSON.stringify(item)} value={JSON.stringify(item)}>
                {item.event} ({item.actor.kind === "presenter" ? "Presenter" : item.actor.source})
              </option>
            ))}
          </select>
          <Button
            disabled={!ready}
            onClick={() =>
              workspace.commands.playback({ command: "semanticEvent", ...selectedEvent })
            }
          >
            イベントを送信
          </Button>
        </div>
      )}
    </div>
  );
}
