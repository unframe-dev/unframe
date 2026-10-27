import { useEffect, useRef, useState } from "react";
import type { PreparedConnection } from "../connection/join-controller";
import { createAudienceAssetFetch } from "../connection/asset-fetch";
import { loadBoardConfig, type BoardConfig } from "../fiducials/config";
import { buildViewerDiagnostic } from "../diagnostics/viewer-diagnostic";
import { SdkProgress } from "../SdkProgress";
import { AudienceStage } from "../ui/AudienceStage";
import { viewingPhase } from "../ui/viewing-phase";
import { createAnchorSession, type AnchorSessionSnapshot } from "./anchor-session";
import { createViewingSession, type RuntimeInput, type ViewingSnapshot } from "./viewing-session";
import type { createTrackingAdapter } from "../tracking/adapter";

export interface ViewerExperienceProps {
  connection: PreparedConnection;
  onLeave(): void;
  onRefresh(): void;
  onReconnect(): Promise<void>;
  refreshing: boolean;
  refreshError: string | null;
  trackingAdapter?: typeof createTrackingAdapter;
  onViewingSnapshot?(snapshot: ViewingSnapshot): void;
  onRuntimeInput?(
    input: RuntimeInput,
    connection: PreparedConnection,
    getConnection: () => PreparedConnection,
    restartInput: () => RuntimeInput | null,
  ): void | (() => void);
  onRecoveryRequest?(
    request: NonNullable<ViewingSnapshot["recovery"]>,
    input: RuntimeInput,
    restartInput: () => RuntimeInput | null,
  ): void;
}
const connectionFailure = "配信の接続準備に失敗しました。もう一度お試しください。";

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

export function ViewerExperience(props: ViewerExperienceProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<ReturnType<typeof createAnchorSession> | null>(null);
  const viewer = useRef<ReturnType<typeof createViewingSession> | null>(null);
  const currentConnection = useRef(props.connection);
  const installer = useRef(props.onRuntimeInput);
  const binding = useRef<{
    input: RuntimeInput;
    installer: ViewerExperienceProps["onRuntimeInput"];
    cleanup?: () => void;
  } | null>(null);
  const recovery = useRef<{ input: RuntimeInput; id: number } | null>(null);
  currentConnection.current = props.connection;
  installer.current = props.onRuntimeInput;
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [anchor, setAnchor] = useState<AnchorSessionSnapshot | null>(null);
  const [viewing, setViewing] = useState<ViewingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  function clearBinding(reportError: boolean) {
    const previous = binding.current;
    binding.current = null;
    try {
      previous?.cleanup?.();
      return true;
    } catch {
      if (reportError) setError(connectionFailure);
      return false;
    }
  }

  useEffect(() => {
    let active = true;
    setConfig(null);
    setError(null);
    void loadBoardConfig()
      .then((board) => {
        if (active) setConfig(board);
      })
      .catch(() => {
        if (active)
          setError("会場の設定を読み込めません。メニューから設定を再読み込みしてください。");
      });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!config || !canvas.current) return;
    let active = true;
    const nextHost = createAnchorSession({
      canvas: canvas.current,
      config,
      showGuides: false,
      ...(props.trackingAdapter ? { trackingAdapter: props.trackingAdapter } : {}),
      fetcher: createAudienceAssetFetch(() => currentConnection.current),
      onChange: (state) => {
        if (active) setAnchor(state);
      },
    });
    const next = createViewingSession(nextHost);
    host.current = nextHost;
    viewer.current = next;
    setAnchor(nextHost.getSnapshot());
    setViewing(next.getSnapshot());
    const unsubscribe = next.subscribe(() => {
      if (active) setViewing(next.getSnapshot());
    });
    return () => {
      active = false;
      clearBinding(false);
      unsubscribe();
      next.dispose();
      if (viewer.current === next) viewer.current = null;
      if (host.current === nextHost) host.current = null;
    };
  }, [config, props.trackingAdapter]);

  useEffect(() => {
    const target = viewer.current;
    const disconnected = target?.getSnapshot().phase === "disconnected";
    target?.updateDelivery(props.connection.delivery);
    if (disconnected && !target?.getInput()) target?.restartInput();
  }, [config, props.connection]);

  useEffect(() => {
    if (viewing) props.onViewingSnapshot?.(viewing);
  }, [viewing, props.onViewingSnapshot]);

  useEffect(() => {
    const input = viewer.current?.getInput() ?? null;
    const currentInstaller = installer.current;
    if (
      (input === binding.current?.input && currentInstaller === binding.current.installer) ||
      (!input && !binding.current)
    )
      return;
    if (!clearBinding(true)) {
      input?.disconnected();
      return;
    }
    if (!input) return;
    const installed: NonNullable<typeof binding.current> = { input, installer: currentInstaller };
    binding.current = installed;
    try {
      const target = viewer.current;
      const cleanup = installer.current?.(
        input,
        structuredClone(currentConnection.current),
        () => {
          if (binding.current !== installed || viewer.current?.getInput() !== input)
            throw new Error("viewing-input-inactive");
          return structuredClone(currentConnection.current);
        },
        () => {
          if (
            binding.current !== installed ||
            viewer.current !== target ||
            target?.getInput() !== input
          )
            return null;
          return target.restartInput();
        },
      );
      if (cleanup) installed.cleanup = cleanup;
    } catch {
      setError(connectionFailure);
      input.disconnected();
    }
  }, [viewing, props.onRuntimeInput]);

  useEffect(() => {
    const request = viewing?.recovery;
    const input = viewer.current?.getInput();
    if (!request || !input || !props.onRecoveryRequest) return;
    if (recovery.current?.input === input && recovery.current.id === request.id) return;
    recovery.current = { input, id: request.id };
    try {
      const target = viewer.current;
      props.onRecoveryRequest(request, input, () => {
        if (
          !target ||
          viewer.current !== target ||
          target.getInput() !== input ||
          target.getSnapshot().recovery?.id !== request.id
        )
          return null;
        return target.restartInput();
      });
    } catch {
      setError(connectionFailure);
      input.disconnected();
    }
  }, [viewing, props.onRecoveryRequest]);

  useEffect(() => {
    if (viewing?.phase !== "disconnected" || !props.onRuntimeInput || props.refreshing) return;
    const timer = setTimeout(() => void props.onReconnect(), 2000);
    return () => clearTimeout(timer);
  }, [viewing?.phase, props.onRuntimeInput, props.refreshing, props.onReconnect]);

  async function start() {
    const target = viewer.current;
    if (!target) return;
    setError(null);
    if (host.current?.getSnapshot().stage === "running") target.restartInput();
    else await target.start(currentConnection.current.delivery);
  }
  function reconnect() {
    setError(null);
    void props.onReconnect();
  }
  function download() {
    const payload = buildViewerDiagnostic({
      tracking: anchor,
      viewing,
      context: host.current?.getDiagnosticContext() ?? null,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "audience-viewer-checkpoint.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visibleError =
    error ??
    anchor?.error ??
    (viewing?.phase === "error" ? "表示の準備に失敗しました。もう一度お試しください。" : null);
  const phase = viewingPhase({
    stage: anchor?.stage ?? "ready",
    tracking: anchor?.tracking ?? "LIMITED",
    detection: anchor?.detection ?? "waiting",
    lastTagAtMs: anchor?.lastTagAtMs,
    contentReady: viewing?.phase === "viewing",
    ended: viewing?.phase === "ended",
    error: visibleError,
  });
  const waiting = waitingCopy(viewing?.phase, !!props.onRuntimeInput);
  const wait =
    anchor?.normalSinceMs == null
      ? 5
      : Math.max(0, 5 - (anchor.nowMs - anchor.normalSinceMs) / 1000);
  return (
    <main className="audience-camera-view">
      <canvas ref={canvas} className="camera" aria-label="カメラ映像とプレゼンテーション" />
      <AudienceStage
        phase={phase}
        normal={anchor?.tracking === "NORMAL"}
        warmupSeconds={wait}
        canStart={!!config && !!anchor && viewing !== null && viewing.phase !== "starting"}
        onStart={() => {
          void start();
        }}
        error={visibleError}
        waitingLabel={waiting.label}
        waitingMessage={waiting.message}
        viewingLabel={viewing?.recovery?.kind === "keyframe" ? "視聴中・状態を再同期中" : "視聴中"}
        menu={
          <>
            {!props.onRuntimeInput && (
              <p>ライブ受信は未接続です。接続仕様の提供後に受信処理を接続します。</p>
            )}
            {props.refreshing && <p role="status">接続情報を更新しています。</p>}
            {props.refreshError && (
              <p role="status">
                接続情報を更新できませんでした。有効期限内の情報で視聴を続けています。
              </p>
            )}
            {viewing?.recovery && (
              <p role="status">
                {viewing.recovery.kind === "keyframe"
                  ? "表示状態の再同期を待っています。"
                  : "プレゼンテーションの再同期を待っています。"}
              </p>
            )}
            <div className="audience-stage__test-controls">
              {(anchor?.stage === "running" || anchor?.stage === "starting") && (
                <button onClick={() => viewer.current?.stop()}>停止</button>
              )}
              <button onClick={props.onRefresh} disabled={props.refreshing}>
                接続情報を更新
              </button>
              {(viewing?.phase === "disconnected" || viewing?.phase === "resync-required") && (
                <button onClick={reconnect}>再接続</button>
              )}
              <button onClick={download}>状態をJSON保存</button>
              <button onClick={props.onLeave}>ルームから退出</button>
            </div>
            <details>
              <summary>設定・診断</summary>
              <p>
                黒いマーカー外周 {config ? (config.markers[0]!.sizeMeters * 100).toFixed(1) : "—"}{" "}
                cm ／ 設定revision {config?.revision ?? "—"}
              </p>
              <p>
                タグ採用 {anchor?.anchorUpdateCount ?? 0}回 ／{" "}
                {anchor?.completionHz == null
                  ? "検出開始待ち"
                  : `${anchor.completionHz.toFixed(1)} Hz`}
              </p>
              <SdkProgress
                {...(anchor?.sdkProgress ? { progress: anchor.sdkProgress } : {})}
                nowMs={anchor?.nowMs ?? 0}
              />
              <button onClick={() => setReload((value) => value + 1)}>設定を再読み込み</button>
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
      >
        {anchor?.mediaPlaybackBlocked && (
          <button
            className="audience-stage__floating-action"
            onClick={() => {
              void host.current
                ?.resumeMediaPlayback()
                .catch(() => setError("動画の再生を開始できませんでした。"));
            }}
          >
            動画・音声の再生を許可
          </button>
        )}
      </AudienceStage>
    </main>
  );
}
