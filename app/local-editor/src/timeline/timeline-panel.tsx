import { useState } from "react";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { cueTimelines } from "../flow/flow-model";
import { Button } from "../ui/button";
import { timePosition } from "./timeline-model";
import "./timeline.css";
export function TimelinePanel() {
  const w = useWorkspace();
  const project = useStore(w.project.store, (s) => s.project);
  const selection = useStore(w.ui, (s) => s.selection);
  const key = useStore(w.ui, (s) => s.key);
  const view = useStore(w.preview.store);
  const [zoom, setZoom] = useState(1);
  const [requested, setRequested] = useState<number | null>(null);
  const definition = project?.definition;
  const step =
    selection.groupId && selection.stepId
      ? definition?.flow.groups[selection.groupId]?.steps[selection.stepId]
      : null;
  const cue = step?.cues.find((c) => c.id === selection.cueId);
  const timelines = definition && cue ? cueTimelines(definition, cue) : [];
  const surfaces =
    cue?.actions.flatMap((action, index) =>
      action.kind === "surface.setState" && action.transition?.kind === "crossfade"
        ? [
            {
              id: `${action.surfaceId}/${index}`,
              duration: action.transition.durationMilliseconds,
              completion: action.transition.completion,
            },
          ]
        : [],
    ) ?? [];
  const occurrence = view.playback?.occurrences.find(
    (o) =>
      o.groupId === selection.groupId &&
      o.stepId === selection.stepId &&
      o.cueId === selection.cueId,
  );
  const inspection = view.playback?.inspection;
  const inspecting = !!inspection && inspection.occurrenceId === occurrence?.occurrenceId;
  const consistent =
    !!view.loaded?.sourceRevision && view.loaded.sourceRevision === project?.revision;
  const ready = view.status === "ready" && consistent;
  const duration =
    occurrence?.durationMilliseconds ??
    Math.max(
      0,
      ...timelines.map((t) => t.timeline.durationMilliseconds),
      ...surfaces.map((t) => t.duration),
    );
  const applied = inspecting ? inspection.timeMilliseconds : 0;
  return (
    <section className="timeline-panel" aria-label="Cue 時間軸">
      <div className="timeline-toolbar">
        <strong>{cue?.id ?? "Cue を選択"}</strong>
        <div className="spacer" />
        <label>
          <select
            aria-label="ズーム"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.5, 1, 2, 4].map((z) => (
              <option key={z} value={z}>
                {z * 100}%
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!ready || !occurrence || inspecting}
          onClick={() => w.commands.inspectCue()}
        >
          この Cue を確認
        </Button>
      </div>
      {!cue ? (
        <p className="empty-state">Cue を選択</p>
      ) : (
        <>
          {(!consistent || !occurrence) && (
            <p className="timeline-note">
              {!consistent
                ? view.channel === "dist"
                  ? "Dist の時間軸は閲覧のみです。"
                  : "表示と Source が一致するまで閲覧のみです。"
                : "再生でこの Cue を発火すると確認できます。"}
            </p>
          )}
          <div className="seek-controls">
            <label>
              <input
                aria-label="Cue の確認時刻"
                title="Cue 発火からの時刻"
                type="range"
                min={0}
                max={duration}
                step={1}
                disabled={!ready || !inspecting || duration === 0}
                value={requested ?? applied}
                onChange={(e) => {
                  const time = Number(e.target.value);
                  setRequested(time);
                  w.commands.seekCue(time);
                }}
                onPointerUp={() => setRequested(null)}
                onBlur={() => setRequested(null)}
                onKeyUp={() => setRequested(null)}
              />
            </label>
            <output
              className="timecode"
              aria-label="表示済みの確認時刻"
              title="Cue 発火からの時刻 / 長さ"
            >
              {applied} / {duration} ms
              {requested !== null && requested !== applied && (
                <span className="muted">（指定 {requested} ms）</span>
              )}
            </output>
          </div>
          <div className="timeline-scroll" tabIndex={0} aria-label="時間軸の横スクロール">
            <div className="timeline-chart" style={{ width: `${220 + 700 * zoom}px` }}>
              <div className="track-row">
                <span className="track-label">対象 / プロパティ</span>
                <div className="track-lane ruler">
                  {Array.from({ length: 11 }, (_, i) => (
                    <span key={i} style={{ left: `${i * 10}%` }}>
                      {Math.round((duration * i) / 10)}ms
                    </span>
                  ))}
                </div>
              </div>
              {inspecting && (
                <div
                  className="playhead"
                  style={{
                    left: `${220 + (700 * zoom * timePosition(applied, duration)) / 100}px`,
                  }}
                />
              )}
              {timelines.map(({ timeline, completion, actionIndex }) => (
                <div key={`${timeline.id}/${actionIndex}`} className="timeline-group">
                  <div className="track-row">
                    <strong className="track-label">
                      {timeline.id}
                      <small>{completion}</small>
                    </strong>
                    <div className="track-lane">
                      <div
                        className="timeline-clip"
                        style={{
                          width: `${timePosition(timeline.durationMilliseconds, duration)}%`,
                        }}
                      >
                        {timeline.durationMilliseconds}ms
                      </div>
                    </div>
                  </div>
                  {timeline.tracks.map((track, index) => (
                    <div className="track-row" key={index}>
                      <div className="track-label">
                        {track.target.nodeId}
                        <small>{track.target.property}</small>
                      </div>
                      <div className="track-lane">
                        {track.keyframes.map((frame) => (
                          <button
                            key={frame.timeMilliseconds}
                            className="keyframe"
                            style={{ left: `${timePosition(frame.timeMilliseconds, duration)}%` }}
                            aria-label={`${track.target.nodeId} / ${track.target.property} / ${frame.timeMilliseconds} ms`}
                            aria-pressed={
                              key?.timelineId === timeline.id &&
                              key.nodeId === track.target.nodeId &&
                              key.property === track.target.property &&
                              key.time === frame.timeMilliseconds
                            }
                            title={`値: ${JSON.stringify(frame.value)} / easing: ${frame.easingToNext ?? "最終キー"}`}
                            onClick={() =>
                              w.commands.selectKey({
                                timelineId: timeline.id,
                                nodeId: track.target.nodeId,
                                property: track.target.property,
                                time: frame.timeMilliseconds,
                                value: JSON.stringify(frame.value),
                                easing: frame.easingToNext ?? "最終キー",
                              })
                            }
                          >
                            ◆
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {surfaces.map((surface) => (
                <div className="track-row" key={surface.id}>
                  <div className="track-label">
                    Surface {surface.id}
                    <small>crossfade / {surface.completion}</small>
                  </div>
                  <div className="track-lane">
                    <div
                      className="timeline-clip surface-clip"
                      style={{ width: `${timePosition(surface.duration, duration)}%` }}
                    >
                      {surface.duration}ms
                    </div>
                  </div>
                </div>
              ))}
              {!timelines.length && !surfaces.length && (
                <p className="empty-state">表示するトラックなし</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
