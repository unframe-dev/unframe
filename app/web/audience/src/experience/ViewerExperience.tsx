import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { markerSizesMillimeters } from "../fiducials/config";
import { SdkProgress } from "../SdkProgress";
import { AudienceStage } from "../ui/AudienceStage";
import { viewingPhase } from "../ui/viewing-phase";
import type { ViewerApplication } from "./viewer-application";
import type { ViewingSnapshot } from "./viewing-session";

function waitingCopy(phase: ViewingSnapshot["phase"] | undefined, connected: boolean) {
  if (phase === "disconnected")
    return { label: "接続が切れました", message: "メニューから再接続してください。" };
  if (phase === "resync-required")
    return {
      label: "プレゼンテーションを再同期しています",
      message: "新しい状態の受信を待っています。",
    };
  if (phase === "loading")
    return {
      label: "プレゼンテーションを準備しています",
      message: "表示に必要なデータを読み込んでいます。",
    };
  return {
    label: "位置合わせができました",
    message: connected ? "プレゼンテーションを待っています。" : "ライブ受信の接続待ちです。",
  };
}

function ViewerMenu({ application }: { application: ViewerApplication }) {
  const {
    anchor,
    config,
    markerSize,
    refreshing,
    recovering,
    refreshError,
    live,
    diagnosticsEnabled,
  } = useStore(application.store);
  const viewing = useStore(
    application.viewingStore,
    useShallow((state) => ({ phase: state.phase, recovery: state.recovery })),
  );
  return (
    <>
      {!live && <p>ライブ受信は未接続です。接続仕様の提供後に受信処理を接続します。</p>}
      {refreshing && (
        <p role="status">
          {recovering ? "配信の接続復旧を待っています。" : "接続情報を更新しています。"}
        </p>
      )}
      {refreshError && (
        <p role="status">接続情報を更新できませんでした。有効期限内の情報で視聴を続けています。</p>
      )}
      {viewing?.recovery && (
        <p role="status">
          {viewing.recovery.kind === "keyframe"
            ? "表示状態の再同期を待っています。"
            : "プレゼンテーションの再同期を待っています。"}
        </p>
      )}
      <label>
        マーカーサイズ（黒い外周）
        <select
          value={markerSize ?? (config ? Math.round(config.markers[0]!.sizeMeters * 1000) : 150)}
          disabled={!config}
          onChange={(event) => application.setMarkerSize(Number(event.target.value))}
        >
          {markerSizesMillimeters.map((size) => (
            <option key={size} value={size}>
              {size} mm
            </option>
          ))}
        </select>
      </label>
      <p>
        白余白を除く一辺の実寸です。登壇側と同じサイズを選んでください。変更後はカメラを開始し、位置合わせをやり直してください。
      </p>
      <div className="audience-stage__test-controls">
        {(anchor?.stage === "running" || anchor?.stage === "starting") && (
          <button onClick={() => application.stop()}>停止</button>
        )}
        <button onClick={application.refresh} disabled={refreshing}>
          接続情報を更新
        </button>
        {(viewing?.phase === "disconnected" || viewing?.phase === "resync-required") && (
          <button onClick={application.reconnect}>再接続</button>
        )}
        <button onClick={application.downloadDiagnostic}>状態をJSON保存</button>
        {diagnosticsEnabled && (
          <button onClick={() => application.downloadConnectionDiagnostic()}>
            接続テストログを保存
          </button>
        )}
        <button onClick={application.leave}>ルームから退出</button>
      </div>
      <details>
        <summary>設定・診断</summary>
        <p>
          黒いマーカー外周 {config ? (config.markers[0]!.sizeMeters * 100).toFixed(1) : "—"} cm ／
          設定revision {config?.revision ?? "—"}
        </p>
        <p>
          タグ採用 {anchor?.anchorUpdateCount ?? 0}回 ／{" "}
          {anchor?.completionHz == null ? "検出開始待ち" : `${anchor.completionHz.toFixed(1)} Hz`}
        </p>
        <SdkProgress
          {...(anchor?.sdkProgress ? { progress: anchor.sdkProgress } : {})}
          nowMs={anchor?.nowMs ?? 0}
        />
        <button onClick={() => void application.reload()}>設定を再読み込み</button>
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
  );
}

export function ViewerExperience({ application }: { application: ViewerApplication }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) application.mount(canvas.current);
    return application.dispose;
  }, [application]);
  const screen = useStore(
    application.store,
    useShallow((state) => ({
      configured: state.config !== null,
      ready: state.anchor !== null,
      stage: state.anchor?.stage ?? "ready",
      tracking: state.anchor?.tracking ?? "LIMITED",
      detection: state.anchor?.detection ?? "waiting",
      lastTagAtMs: state.anchor?.lastTagAtMs == null ? null : 1,
      blocked: state.anchor?.mediaPlaybackBlocked,
      error: state.error ?? state.anchor?.error,
      live: state.live,
      wait:
        state.anchor?.normalSinceMs == null
          ? 5
          : Math.max(0, Math.ceil(5 - (state.anchor.nowMs - state.anchor.normalSinceMs) / 1000)),
    })),
  );
  const viewing = useStore(
    application.viewingStore,
    useShallow((state) => ({
      phase: state.phase,
      error: state.error,
      recovery: state.recovery?.kind,
    })),
  );
  const visibleError =
    screen.error ??
    (viewing.phase === "error" ? "表示の準備に失敗しました。もう一度お試しください。" : null);
  const phase = viewingPhase({
    ...screen,
    contentReady: viewing.phase === "viewing",
    ended: viewing.phase === "ended",
    error: visibleError,
  });
  const waiting = waitingCopy(viewing.phase, screen.live);
  return (
    <main className="audience-camera-view">
      <canvas ref={canvas} className="camera" aria-label="カメラ映像とプレゼンテーション" />
      <AudienceStage
        phase={phase}
        normal={screen.tracking === "NORMAL"}
        warmupSeconds={screen.wait}
        canStart={screen.configured && screen.ready && viewing.phase !== "starting"}
        onLeave={application.leave}
        onStart={() => void application.start()}
        error={visibleError}
        waitingLabel={waiting.label}
        waitingMessage={waiting.message}
        viewingLabel={viewing.recovery === "keyframe" ? "視聴中・状態を再同期中" : "視聴中"}
        menu={<ViewerMenu application={application} />}
      >
        {screen.blocked && (
          <button
            className="audience-stage__floating-action"
            onClick={() => void application.resumeMedia()}
          >
            動画・音声の再生を許可
          </button>
        )}
      </AudienceStage>
    </main>
  );
}
