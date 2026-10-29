import { AudienceStage } from "../../ui/AudienceStage";
import { viewingPhase } from "../../ui/viewing-phase";
import { SdkProgress } from "../../SdkProgress";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createAnchorSession, type AnchorSessionSnapshot } from "../../experience/anchor-session";
import { configureTagBoard, loadBoardConfig, selectedTagProfile } from "../../fiducials/config";
import type { BoardConfig } from "../../fiducials/config";
import type { createRuntimePlayback } from "../../runtime/playback";
import { createViewingSession, createViewingStore } from "../../experience/viewing-session";
import { createFixtureScenario } from "./scenario";
import { createMediaFixtureScenario } from "./media-scenario";
import { summarizeRuntime } from "./checkpoint";
import {
  safeDiagnosticError,
  summarizeTrackingDiagnostics,
} from "../../diagnostics/tracking-summary";
import "./fixture.css";

type Scenario = Awaited<ReturnType<typeof createFixtureScenario>>;
type Runtime = ReturnType<typeof createRuntimePlayback>;
type RuntimeSnapshot = ReturnType<Runtime["getSnapshot"]>;

export function FixtureExperience() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<ReturnType<typeof createAnchorSession> | null>(null);
  const runtime = useRef<ReturnType<typeof createViewingSession> | null>(null);
  const generation = useRef(0);
  const lastReadyRuntime = useRef<ReturnType<typeof summarizeRuntime>>(null);
  function recordPlayback(state: RuntimeSnapshot) {
    if (state.phase === "ready" && state.rendering === "ready")
      lastReadyRuntime.current = summarizeRuntime(state);
  }
  const [size, setSize] = useState(() =>
    new URLSearchParams(window.location.search).get("size") === "36" ? "36" : "22.5",
  );
  const [fixtureKind, setFixtureKind] = useState("png");
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [anchor, setAnchor] = useState<AnchorSessionSnapshot | null>(null);
  const [viewingStore] = useState(createViewingStore);
  const playback = useStore(viewingStore, (state) => state.runtime);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setConfig(null);
    setScenario(null);
    setError(null);
    void Promise.all([
      loadBoardConfig(),
      fixtureKind === "png"
        ? createFixtureScenario(window.location.origin)
        : createMediaFixtureScenario(window.location.origin, {
            joiningMidPlayback: fixtureKind === "media-late",
          }),
    ])
      .then(([board, fixture]) => {
        if (!active) return;
        setConfig(configureTagBoard(board, selectedTagProfile(`?size=${size}`)));
        setScenario(fixture);
      })
      .catch(() => {
        if (active) setError("テストデータを準備できませんでした。再読み込みしてください。");
      });
    return () => {
      active = false;
    };
  }, [size, reload, fixtureKind]);

  useEffect(() => {
    if (!config || !canvas.current) return;
    const current = createAnchorSession({ canvas: canvas.current, config, onChange: setAnchor });
    session.current = current;
    const viewer = createViewingSession(current, viewingStore);
    runtime.current = viewer;
    const unsubscribe = viewer.store.subscribe(({ runtime: state }) => {
      if (state) recordPlayback(state);
    });
    setAnchor(current.getSnapshot());
    return () => {
      generation.current++;
      runtime.current = null;
      unsubscribe();
      viewer.dispose();
      if (session.current === current) session.current = null;
    };
  }, [config, viewingStore]);

  async function initialize(startCamera: boolean) {
    const current = runtime.current;
    if (!current || !scenario || busy) return;
    const attempt = ++generation.current;
    setBusy(true);
    setError(null);
    lastReadyRuntime.current = null;
    try {
      await current.start(scenario.delivery, startCamera);
      if (attempt !== generation.current) return;
      if (session.current?.getSnapshot().stage !== "running" || !current.getInput()) {
        setError(session.current?.getSnapshot().error ?? "カメラを開始できませんでした。");
        return;
      }
      current.getInput()!.applyControl({ connectionSnapshot: scenario.snapshot });
      setStarted(true);
      setActionIndex(0);
      await current.waitForIdle();
      const state = current.getRuntimeSnapshot();
      if (attempt === generation.current && state) recordPlayback(state);
    } catch {
      if (attempt === generation.current)
        setError("表示を準備できませんでした。初期状態から再試行してください。");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  async function advance() {
    const current = runtime.current;
    const action = scenario?.actions[actionIndex];
    if (!current || !action || busy) return;
    const attempt = generation.current;
    setBusy(true);
    try {
      current.getInput()?.applyControl(action.item);
      await current.waitForIdle();
      if (attempt !== generation.current) return;
      const state = current.getRuntimeSnapshot();
      if (state) recordPlayback(state);
      setActionIndex((value) => value + 1);
    } catch {
      if (attempt === generation.current)
        setError("操作を適用できませんでした。初期状態から再試行してください。");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  function stop() {
    generation.current++;
    runtime.current?.stop();
    setActionIndex(0);
    setStarted(false);
    setBusy(false);
    lastReadyRuntime.current = null;
    setError(null);
  }

  function downloadCheckpoint() {
    const state = runtime.current?.getRuntimeSnapshot() ?? playback;
    const payload = {
      schemaVersion: 2,
      mode: "audience-fixture",
      markerSizeMeters: size === "36" ? 0.24 : 0.15,
      fixtureKind,
      mediaPlaybackBlocked: anchor?.mediaPlaybackBlocked ?? false,
      appliedActionCount: actionIndex,
      lastAction: actionIndex > 0 ? scenario?.actions[actionIndex - 1]?.label : "Snapshot",
      tracking: anchor
        ? {
            stage: anchor.stage,
            error: safeDiagnosticError(anchor.error),
            status: anchor.tracking,
            detection: anchor.detection,
            anchorUpdateCount: anchor.anchorUpdateCount,
            completionHz: anchor.completionHz,
          }
        : null,
      runtime: summarizeRuntime(state),
      lastReadyRuntime: lastReadyRuntime.current,
      diagnostics: summarizeTrackingDiagnostics(session.current?.getDiagnosticContext()),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "audience-fixture-checkpoint.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const runtimeError = playback?.error ?? playback?.reason;
  const visibleError = error ?? anchor?.error ?? runtimeError ?? null;
  const action = scenario?.actions[actionIndex];
  const view = playback?.view;
  const phase = viewingPhase({
    stage: !started && !busy ? "ready" : (anchor?.stage ?? "starting"),
    tracking: anchor?.tracking ?? "LIMITED",
    detection: anchor?.detection ?? "waiting",
    lastTagAtMs: anchor?.lastTagAtMs,
    error: visibleError,
    ended: playback?.phase === "ended",
    contentReady: playback?.rendering === "ready" && playback?.view != null,
  });
  const wait =
    anchor?.normalSinceMs == null
      ? 5
      : Math.max(0, 5 - ((anchor?.nowMs ?? 0) - anchor.normalSinceMs) / 1000);

  return (
    <main className="fixture-experience">
      <canvas ref={canvas} className="fixture-camera" aria-label="XRカメラ" />
      <AudienceStage
        phase={phase}
        onLeave={() => {
          generation.current++;
          runtime.current?.dispose();
          runtime.current = null;
          window.location.assign("/");
        }}
        normal={anchor?.tracking === "NORMAL"}
        warmupSeconds={wait}
        canStart={!!config && !!scenario && !busy}
        onStart={() => {
          void initialize(true);
        }}
        error={visibleError}
        notice={<small>表示テスト・サーバー未接続</small>}
        menu={
          <section className="fixture-panel" aria-label="fixtureテスト操作">
            <header>
              <span className="fixture-badge">テスト専用</span>
              <a href="/">通常画面に戻る</a>
            </header>
            <h1>プレゼン表示テスト</h1>
            <p>サーバー未接続。操作ボタンで固定テスト時刻へ進めます。</p>
            <label>
              テスト内容{" "}
              <select
                value={fixtureKind}
                disabled={started || busy}
                onChange={(event) => {
                  stop();
                  setFixtureKind(event.target.value);
                }}
              >
                <option value="png">PNG・進行状態</option>
                <option value="media">PNG・動画・GLB</option>
                <option value="media-late">動画・GLBの途中参加（2秒地点）</option>
              </select>
            </label>
            <label>
              黒いタグ外周の一辺{" "}
              <select
                value={size}
                disabled={started || busy}
                onChange={(event) => {
                  stop();
                  setSize(event.target.value);
                }}
              >
                <option value="22.5">15 cm</option>
                <option value="36">24 cm</option>
              </select>
            </label>
            <a href={`/markers/april-single-${size}.svg`} target="_blank" rel="noreferrer">
              AprilTagを表示・印刷
            </a>
            <p>印刷倍率は100%にし、黒い外周の実寸を測り、白余白を残してください。</p>
            <p>
              {busy ? "表示を準備中" : playback?.rendering === "ready" ? "表示準備完了" : "待機中"}
            </p>
            {visibleError && <p>{visibleError}</p>}
            <SdkProgress
              {...(anchor?.sdkProgress ? { progress: anchor.sdkProgress } : {})}
              nowMs={anchor?.nowMs ?? 0}
            />
            <div className="fixture-buttons">
              {(started || busy) && <button onClick={stop}>停止</button>}
              {started && (
                <button
                  disabled={busy}
                  onClick={() => {
                    void initialize(anchor?.stage !== "running");
                  }}
                >
                  {visibleError ? "初期状態から再試行" : "初期状態に戻す"}
                </button>
              )}
              {!started && error && (
                <button disabled={busy} onClick={() => setReload((value) => value + 1)}>
                  テストデータを再読み込み
                </button>
              )}
              {started && action && (
                <button
                  disabled={busy || Boolean(visibleError)}
                  onClick={() => {
                    void advance();
                  }}
                >
                  次の操作：{action.label}
                </button>
              )}
              <button disabled={!scenario} onClick={downloadCheckpoint}>
                状態をJSON保存
              </button>
            </div>
            {started && !action && <p>すべての操作を適用しました</p>}
            <dl>
              <dt>適用した操作</dt>
              <dd>
                {actionIndex} / {scenario?.actions.length ?? 0}
              </dd>
              <dt>Group</dt>
              <dd>{view?.progression.currentGroupId ?? "—"}</dd>
              <dt>Run</dt>
              <dd>{view?.activeRuns.length ?? 0}</dd>
              <dt>動画・GLB</dt>
              <dd>
                {view
                  ? `動画 ${Object.keys(view.mediaStates).length} ／ GLB ${Object.keys(view.modelClipStates).length}`
                  : "—"}
              </dd>
              <dt>変数</dt>
              <dd>{view ? JSON.stringify(view.variables) : "—"}</dd>
              <dt>Runtime</dt>
              <dd>{playback?.phase ?? "未接続"}</dd>
            </dl>
          </section>
        }
      >
        {started && anchor?.mediaPlaybackBlocked && (
          <button
            className="audience-stage__floating-action"
            onClick={() => {
              void session.current
                ?.resumeMediaPlayback()
                .catch(() => setError("動画の再生を開始できませんでした。"));
            }}
          >
            動画の再生を許可
          </button>
        )}
      </AudienceStage>
    </main>
  );
}
