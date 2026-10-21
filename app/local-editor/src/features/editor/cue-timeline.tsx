import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import { useEffect, useRef, useState } from "react";
import "./cue-timeline.css";

type Timeline = NonNullable<ProjectSnapshot["definition"]>["flow"]["timelines"][string];
type CueTimelineEntry = {
  timeline: Timeline;
  completion: "blocking" | "nonBlocking";
  actionIndex: number;
};

function keyframeIdentity(
  entry: CueTimelineEntry,
  track: Timeline["tracks"][number],
  time: number,
) {
  return JSON.stringify([entry.timeline.id, track.target.nodeId, track.target.property, time]);
}

function formatValue(value: Timeline["tracks"][number]["keyframes"][number]["value"]) {
  return Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
}

export function CueTimeline({
  timelines,
  focusedTimelineId = null,
  focusRequestId = 0,
}: {
  timelines: CueTimelineEntry[];
  focusedTimelineId?: string | null;
  focusRequestId?: number;
}) {
  const groups = useRef(new Map<string, HTMLDivElement>());
  const focusedId = timelines.some(({ timeline }) => timeline.id === focusedTimelineId)
    ? focusedTimelineId
    : null;
  useEffect(() => {
    if (!focusedId) return;
    const group = groups.current.get(focusedId);
    group?.focus({ preventScroll: true });
    group?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusedId, focusRequestId]);
  const [zoom, setZoom] = useState(1);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const selected = timelines
    .flatMap((entry) =>
      entry.timeline.tracks.flatMap((track) =>
        track.keyframes.map((keyframe) => ({
          entry,
          track,
          keyframe,
          identity: keyframeIdentity(entry, track, keyframe.timeMilliseconds),
        })),
      ),
    )
    .find(({ identity }) => identity === selectedIdentity);
  const selectionExists = selected !== undefined;
  useEffect(() => {
    if (!selectionExists) setSelectedIdentity(null);
  }, [selectionExists]);
  const duration = Math.max(0, ...timelines.map(({ timeline }) => timeline.durationMilliseconds));
  const width = 800 * zoom;
  const tickCount = 20;
  const position = (time: number) => `${duration === 0 ? 0 : (time / duration) * 100}%`;
  return (
    <section className="editor-cue-timeline" aria-label="Cue のアニメーション時間軸">
      <header className="editor-cue-timeline-toolbar">
        <h3>アニメーション時間軸</h3>
        <span className="editor-cue-timeline-time">
          {selected
            ? `選択キー: Cue + ${selected.keyframe.timeMilliseconds} ms`
            : "Cue 発火 + 0 ms"}
        </span>
        {timelines.length > 0 && (
          <label className="editor-cue-timeline-zoom">
            時間軸のズーム
            <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
              {[0.5, 1, 2, 4].map((scale) => (
                <option key={scale} value={scale}>
                  {scale * 100}%
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <p>Cue 発火からの時間（Step の滞在時間ではありません）</p>
      {timelines.length === 0 ? (
        <p>この Cue に timeline.play はありません。</p>
      ) : (
        <div className="editor-cue-timeline-workspace">
          <div
            className="editor-cue-timeline-scroll"
            tabIndex={0}
            aria-label="アニメーション時間軸の横スクロール"
          >
            <div className="editor-cue-timeline-chart" style={{ width: `${280 + width}px` }}>
              <div className="editor-cue-timeline-row">
                <span className="editor-cue-timeline-target">対象 Node / プロパティ</span>
                <div
                  className="editor-cue-timeline-ruler"
                  role="img"
                  aria-label={`Cue 発火から 0–${duration} ms`}
                >
                  {Array.from({ length: tickCount + 1 }, (_, index) => (
                    <span
                      key={index}
                      className={index % 5 === 0 ? "major" : "minor"}
                      style={{ left: `${index * 5}%` }}
                    >
                      {index % 5 === 0 ? `${(duration * index) / tickCount} ms` : null}
                    </span>
                  ))}
                </div>
              </div>
              {selected && (
                <div
                  className="editor-cue-timeline-selection"
                  style={{
                    left: `${260 + (width * selected.keyframe.timeMilliseconds) / Math.max(duration, 1)}px`,
                  }}
                  aria-hidden="true"
                >
                  <span>選択キー</span>
                </div>
              )}
              {timelines.map((entry) => {
                const { timeline, completion } = entry;
                return (
                  <div
                    key={timeline.id}
                    className="editor-cue-timeline-group"
                    role="group"
                    aria-label={`Timeline ${timeline.id}`}
                    tabIndex={-1}
                    data-focused={focusedId === timeline.id}
                    ref={(element) => {
                      if (element) groups.current.set(timeline.id, element);
                      else groups.current.delete(timeline.id);
                    }}
                  >
                    <div className="editor-cue-timeline-row editor-cue-timeline-clip-row">
                      <div className="editor-cue-timeline-target">
                        <h4>{timeline.id}</h4>
                        <span>duration: {timeline.durationMilliseconds} ms</span>
                      </div>
                      <div className="editor-cue-timeline-lane">
                        <div
                          className="editor-cue-timeline-clip"
                          role="img"
                          aria-label={`${timeline.id} のクリップ: Cue 発火から 0–${timeline.durationMilliseconds} ms`}
                          style={{ width: position(timeline.durationMilliseconds) }}
                        >
                          <span>{timeline.id}</span>
                        </div>
                      </div>
                    </div>
                    <div className="editor-cue-timeline-meta">
                      <span>
                        {completion === "blocking"
                          ? "blocking: 開始した Run の完了まで遷移を待機"
                          : "nonBlocking: 完了を待たずに遷移"}
                      </span>
                    </div>
                    {timeline.tracks.map((track) => (
                      <div
                        className="editor-cue-timeline-row"
                        role="group"
                        aria-label={`${timeline.id} / ${track.target.nodeId} / ${track.target.property}`}
                        key={`${track.target.nodeId}/${track.target.property}`}
                      >
                        <div className="editor-cue-timeline-target">
                          <span>{track.target.nodeId}</span>
                          <span>{track.target.property}</span>
                        </div>
                        <div className="editor-cue-timeline-lane">
                          {track.keyframes.map((keyframe) => (
                            <button
                              type="button"
                              key={keyframe.timeMilliseconds}
                              className="editor-cue-timeline-key"
                              aria-label={`Cue 発火から ${keyframe.timeMilliseconds} ms`}
                              aria-pressed={
                                selectedIdentity ===
                                keyframeIdentity(entry, track, keyframe.timeMilliseconds)
                              }
                              onClick={() =>
                                setSelectedIdentity(
                                  keyframeIdentity(entry, track, keyframe.timeMilliseconds),
                                )
                              }
                              title={`値: ${formatValue(keyframe.value)} / easing: ${keyframe.easingToNext ?? "なし（最終キー）"}`}
                              style={{
                                left: position(keyframe.timeMilliseconds),
                              }}
                            >
                              <span className="editor-cue-timeline-diamond" aria-hidden="true">
                                ◆
                              </span>
                              <span className="editor-cue-timeline-key-value" aria-hidden="true">
                                {formatValue(keyframe.value)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {selected ? (
            <section className="editor-cue-timeline-details" aria-label="選択したキーフレーム">
              <h4>
                {selected.entry.timeline.id} / {selected.track.target.nodeId} /{" "}
                {selected.track.target.property}
              </h4>
              <dl>
                <dt>時刻</dt>
                <dd>Cue 発火から {selected.keyframe.timeMilliseconds} ms</dd>
                <dt>値</dt>
                <dd>{formatValue(selected.keyframe.value)}</dd>
                <dt>次のキーまでの easing</dt>
                <dd>{selected.keyframe.easingToNext ?? "なし（最終キー）"}</dd>
              </dl>
            </section>
          ) : (
            <aside className="editor-cue-timeline-details editor-cue-timeline-inspector-empty">
              <h4>キーフレーム</h4>
              <p>◆ を選択して時刻・値・easing を確認</p>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
