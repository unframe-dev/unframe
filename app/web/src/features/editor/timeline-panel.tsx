import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import "./timeline-panel.css";

const axisPosition = (fraction: number) => 20 + 960 * fraction;

export function TimelinePanel({ definition }: { definition: ProjectSnapshot["definition"] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timelines = definition ? Object.values(definition.flow.timelines) : [];
  const timeline = timelines.find((entry) => entry.id === selectedId) ?? timelines[0];
  const currentId = timeline?.id ?? null;
  useEffect(() => {
    setSelectedId(currentId);
  }, [currentId]);
  return (
    <section aria-label="Timelines" className="editor-timeline">
      <h2>Timelines</h2>
      {!definition ? (
        <p>定義を取得できていません。読み込み状態と診断を確認してください。</p>
      ) : !timeline ? (
        <p>Timeline は定義されていません。</p>
      ) : (
        <>
          <div className="editor-timeline-selection">
            <label>
              Timeline を選択
              <select value={timeline.id} onChange={(event) => setSelectedId(event.target.value)}>
                {timelines.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
            </label>
            <span>閲覧専用</span>
          </div>
          <h3>{timeline.id}</h3>
          <div className="editor-timeline-meta">
            <span>
              所有:{" "}
              {timeline.owner.kind === "group"
                ? `group / ${timeline.owner.groupId}`
                : "presentation"}
            </span>
            <span>長さ: {timeline.durationMilliseconds} ms</span>
          </div>
          <div className="editor-timeline-scroll" tabIndex={0} aria-label="Timeline の時間軸">
            <div className="editor-timeline-chart">
              <div className="editor-timeline-row editor-timeline-ruler">
                <span>対象 / プロパティ</span>
                <svg
                  viewBox="0 0 1000 40"
                  role="img"
                  aria-label={`時間目盛 0–${timeline.durationMilliseconds} ms`}
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                    <g key={fraction} transform={`translate(${axisPosition(fraction)} 0)`}>
                      <text
                        y="16"
                        textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}
                      >
                        {timeline.durationMilliseconds * fraction} ms
                      </text>
                      <line y1="26" y2="40" />
                    </g>
                  ))}
                </svg>
              </div>
              {timeline.tracks.map((track) => (
                <div
                  className="editor-timeline-row"
                  key={`${track.target.nodeId}/${track.target.property}`}
                >
                  <div className="editor-timeline-target">
                    <span>{track.target.nodeId}</span>
                    <span>{track.target.property}</span>
                  </div>
                  <svg
                    viewBox="0 0 1000 40"
                    role="img"
                    aria-label={`${track.target.nodeId} / ${track.target.property} のキー位置`}
                  >
                    {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                      <line
                        key={fraction}
                        x1={axisPosition(fraction)}
                        x2={axisPosition(fraction)}
                        y1="0"
                        y2="40"
                      />
                    ))}
                    {track.keyframes.map((keyframe) => (
                      <polygon
                        key={keyframe.timeMilliseconds}
                        data-time-ms={keyframe.timeMilliseconds}
                        transform={`translate(${axisPosition(keyframe.timeMilliseconds / timeline.durationMilliseconds)} 20)`}
                        points="0,-7 7,0 0,7 -7,0"
                      />
                    ))}
                  </svg>
                </div>
              ))}
            </div>
          </div>
          <p className="editor-timeline-note">
            ◆ キーフレームの時刻を表示しています。値と次のキーまでの easing は詳細で確認できます。
          </p>
          <div className="editor-timeline-details">
            {timeline.tracks.map((track) => (
              <details key={`${timeline.id}/${track.target.nodeId}/${track.target.property}`}>
                <summary>
                  {track.target.nodeId} / {track.target.property} のキーフレーム (
                  {track.keyframes.length})
                </summary>
                <div className="editor-timeline-table-scroll">
                  <table
                    aria-label={`${track.target.nodeId} / ${track.target.property} のキーフレーム`}
                  >
                    <thead>
                      <tr>
                        <th scope="col">時刻</th>
                        <th scope="col">値</th>
                        <th scope="col">次のキーまでの easing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {track.keyframes.map((keyframe) => (
                        <tr key={keyframe.timeMilliseconds}>
                          <td>{keyframe.timeMilliseconds} ms</td>
                          <td>
                            {Array.isArray(keyframe.value)
                              ? `[${keyframe.value.join(", ")}]`
                              : keyframe.value}
                          </td>
                          <td>{keyframe.easingToNext ?? "なし（最終キー）"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
