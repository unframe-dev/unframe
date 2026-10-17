import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import { useEffect, useState } from "react";
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

export function CueTimeline({ timelines }: { timelines: CueTimelineEntry[] }) {
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
  return (
    <section className="editor-cue-timeline" aria-label="Cue のアニメーション時間軸">
      <h3>アニメーション時間軸</h3>
      <p>Cue 発火からの時間（Step の滞在時間ではありません）</p>
      {timelines.length === 0 ? (
        <p>この Cue に timeline.play はありません。</p>
      ) : (
        <>
          <label className="editor-cue-timeline-zoom">
            時間軸のズーム
            <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
              <option value={1}>100%</option>
              <option value={2}>200%</option>
              <option value={4}>400%</option>
            </select>
          </label>
          <div
            className="editor-cue-timeline-scroll"
            tabIndex={0}
            aria-label="アニメーション時間軸の横スクロール"
          >
            <div
              className="editor-cue-timeline-chart"
              style={{ minWidth: `${240 + 660 * zoom}px` }}
            >
              <div className="editor-cue-timeline-row">
                <span>対象 Node / プロパティ</span>
                <div
                  className="editor-cue-timeline-ruler"
                  role="img"
                  aria-label={`Cue 発火から 0–${duration} ms`}
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                    <span key={fraction} style={{ left: `${fraction * 100}%` }}>
                      {duration * fraction} ms
                    </span>
                  ))}
                </div>
              </div>
              {timelines.map((entry) => {
                const { timeline, completion } = entry;
                return (
                  <div key={timeline.id}>
                    <div className="editor-cue-timeline-meta">
                      <h4>{timeline.id}</h4>
                      <span>duration: {timeline.durationMilliseconds} ms</span>
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
                                left: `${duration === 0 ? 0 : (keyframe.timeMilliseconds / duration) * 100}%`,
                              }}
                            >
                              <span aria-hidden="true">◆</span>
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
        </>
      )}
      {selected && (
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
      )}
    </section>
  );
}
