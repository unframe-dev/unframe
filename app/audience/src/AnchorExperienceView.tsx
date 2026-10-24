import { AudienceStage } from "./ui/AudienceStage";
import { viewingPhase } from "./ui/viewing-phase";
import { SdkProgress } from "./SdkProgress";
import type { SdkProgress as Progress } from "./tracking/progress";
import type { Ref } from "react";
import type { BoardConfig, TagProfile } from "./fiducials/config";

export interface AnchorExperienceViewProps {
  canvasRef: Ref<HTMLCanvasElement>;
  stage: "loading" | "ready" | "starting" | "running" | "stopped" | "error";
  error: string | null;
  config: BoardConfig | null;
  profile: TagProfile | null;
  tracking: "NORMAL" | "LIMITED";
  detection: "waiting" | "preparing" | "active";
  nowMs: number;
  normalSinceMs: number | null;
  completionHz: number | null;
  anchorUpdateCount: number;
  lastTagAtMs: number | null;
  localizationReason: string;
  captureAvailable: boolean;
  sdkProgress?: Progress;
  contentReady?: boolean;
  onLeave?(): void;
  onChangeSize(size: string): void;
  onStart(): void;
  onStop(): void;
  onDownload(includeImage?: boolean): void;
}

export function AnchorExperienceView(props: AnchorExperienceViewProps) {
  const { stage, config, profile, tracking, detection, normalSinceMs, nowMs, error } = props;
  const phase = viewingPhase({
    stage,
    tracking,
    detection,
    lastTagAtMs: props.lastTagAtMs,
    contentReady: props.contentReady ?? true,
    error,
  });
  const wait = normalSinceMs === null ? 5 : Math.max(0, 5 - (nowMs - normalSinceMs) / 1000);
  return (
    <main className="audience-camera-view">
      <canvas
        ref={props.canvasRef}
        className="camera"
        aria-label="カメラ映像とタグ位置をSDKで保持するライブ表示"
      />
      <AudienceStage
        phase={phase}
        normal={tracking === "NORMAL"}
        warmupSeconds={wait}
        onStart={props.onStart}
        canStart={!!config && stage !== "loading"}
        error={error}
        viewingLabel="位置合わせ済み"
        menu={
          <>
            <p>
              {props.contentReady === false
                ? "位置合わせ後、プレゼンテーションを待機します。ライブ受信は未接続です。"
                : "位置合わせの確認画面です。ライブ配信の受信は未接続です。"}
            </p>
            <div className="audience-stage__test-controls">
              {(stage === "running" || stage === "starting") && (
                <button onClick={props.onStop}>停止</button>
              )}
              <button onClick={() => props.onDownload()}>JSONログを保存</button>
              {props.onLeave && <button onClick={props.onLeave}>ルームから退出</button>}
            </div>
            <details>
              <summary>設定・診断</summary>
              <label>
                マーカーの外寸{" "}
                <select
                  value={profile?.sizeCm ?? 22.5}
                  disabled={stage === "running" || stage === "starting"}
                  onChange={(event) => props.onChangeSize(event.target.value)}
                >
                  <option value="22.5">22.5 cm（黒い外周15 cm）</option>
                  <option value="36">36 cm（黒い外周24 cm）</option>
                  <option value="50">50 cm</option>
                  <option value="60">60 cm</option>
                  <option value="70">70 cm</option>
                </select>
              </label>
              <p>
                黒いマーカー外周 {config ? (config.markers[0]!.sizeMeters * 100).toFixed(1) : "—"}{" "}
                cm
              </p>
              <a
                href={`/print-target.html?size=${profile?.sizeCm ?? 22.5}`}
                target="_blank"
                rel="noreferrer"
              >
                マーカーを表示・印刷
              </a>
              <p>
                タグ採用 {props.anchorUpdateCount}回 ／{" "}
                {props.completionHz === null
                  ? "検出開始待ち"
                  : `${props.completionHz.toFixed(1)} Hz`}{" "}
                ／ {props.localizationReason}
              </p>
              <SdkProgress
                {...(props.sdkProgress ? { progress: props.sdkProgress } : {})}
                nowMs={nowMs}
              />
              <button disabled={!props.captureAvailable} onClick={() => props.onDownload(true)}>
                検出入力画像付きJSONを保存
              </button>
              <p>カメラ画像1枚を含むログを端末に保存します。周囲の映り込みを含みます。</p>
            </details>
            <details>
              <summary>ライセンス</summary>
              <p>XR Engine: Niantic Spatial, Inc. Copyright © 2026. All rights reserved.</p>
              <p>
                <a href="/external/xr/LICENSE">XR Engine License Agreement</a>
              </p>
              <p>
                <a href="/external/detectors/LICENSE.wrapper">AprilTag wrapper BSD-3</a>
              </p>
              <p>
                <a href="/external/detectors/LICENSE.apriltag">AprilTag BSD-2</a>
              </p>
              <p>
                <a href="/external/detectors/LICENSE.posit">POSIT・SVD MIT</a>
              </p>
              <p>
                <a href="/external/detectors/apriltag_36h11.js">AprilTag dictionary BSD-3</a>
              </p>
              <p>
                <a href="/external/detectors/provenance.json">取得元・SHA-256</a>
              </p>
              <p>
                <a href="/external/engine-manifest.json">XR Engine配布物ハッシュ</a>
              </p>
            </details>
          </>
        }
      />
    </main>
  );
}
