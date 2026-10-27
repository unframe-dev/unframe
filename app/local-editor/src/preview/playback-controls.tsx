import { useStore } from "zustand";
import { PlayIcon, PauseIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
export function PlaybackControls() {
  const w = useWorkspace();
  const { playback: p, status } = useStore(w.preview.store);
  const ready = status === "ready";
  const inspection = p?.mode === "inspection";
  return (
    <div className="playback-controls">
      <div className="flex items-center gap-2">
        {inspection && (
          <span className="mode-tag">
            Cue 確認:{" "}
            {p.occurrences.find((o) => o.occurrenceId === p.inspection?.occurrenceId)?.cueId}
          </span>
        )}
        <Button
          aria-label="再生"
          title="再生"
          disabled={!ready || !p || p.ended || !!p.state.clock?.running}
          onClick={() => {
            (window as Window & { unframeVideoActivate?: () => void }).unframeVideoActivate?.();
            w.commands.playback({ command: "play" });
          }}
        >
          <PlayIcon weight="fill" />
        </Button>
        <Button
          aria-label="一時停止"
          title="一時停止"
          disabled={!ready || !p?.state.clock?.running}
          onClick={() => w.commands.playback({ command: "pause" })}
        >
          <PauseIcon weight="fill" />
        </Button>
        <Button
          aria-label={inspection ? "0秒へ" : "リセット"}
          title={inspection ? "0秒へ" : "リセット"}
          disabled={!ready || !p}
          onClick={() =>
            inspection && p.inspection
              ? w.commands.playback({
                  command: "seekCue",
                  inspectionId: p.inspection.inspectionId,
                  timeMilliseconds: 0,
                })
              : w.commands.playback({ command: "reset" })
          }
        >
          <ArrowCounterClockwiseIcon />
        </Button>
        <span className="timecode">
          {(
            ((inspection
              ? p.inspection?.timeMilliseconds
              : Number(p?.state.clock?.runtimeTimeMs ?? 0)) ?? 0) / 1000
          ).toFixed(2)}{" "}
          s
        </span>
        {inspection && (
          <Button disabled={!ready} onClick={() => w.commands.leaveInspection()}>
            通常再生に戻る
          </Button>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {!inspection &&
          p?.inputs.map((input) => (
            <Button
              key={input.cueId}
              disabled={!ready || !p.state.clock?.running}
              onClick={() => w.commands.playback({ command: "input", cueId: input.cueId })}
            >
              {input.label}
            </Button>
          ))}
        {!inspection && p && (
          <small className="muted">
            {p.groupId} / {p.stepId}
            {p.ended ? " ・終了" : ""}
          </small>
        )}
      </div>
    </div>
  );
}
