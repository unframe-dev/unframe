import { serializeDetectorInput, type DetectorInputCapture } from "./tracking/input-capture";
import { useEffect, useRef, useState } from "react";
import { createTrackingAdapter } from "./tracking/adapter";
import { createDiagnostics } from "./tracking/diagnostics";
import { createTagLocalizationState, reduceTagLocalization } from "./fiducials/tag-localization";
import { poseEstimatorPolicy } from "./fiducials/pose";
import { displayJitterPolicy } from "./rendering/jitter-filter";
import { createLiveTagAnchor } from "./rendering/live-tag-anchor";
import {
  detectorImplementations,
  loadBoardConfig,
  selectedTagProfile,
  configureTagBoard,
} from "./fiducials/config";
import type { BoardConfig, TagProfile } from "./fiducials/config";
import "./styles.css";

type Stage = "loading" | "ready" | "starting" | "running" | "stopped" | "error";
const normalWarmupMs = 5000;
async function requestMotionPermissions() {
  const results = await Promise.all(
    (["DeviceOrientationEvent", "DeviceMotionEvent"] as const).map((name) => {
      const provider = window[name] as unknown as
        | { requestPermission?: () => Promise<string> }
        | undefined;
      return provider?.requestPermission?.();
    }),
  );
  if (results.some((value) => value !== undefined && value !== "granted"))
    throw new Error("動きの検出を許可してから、もう一度開始してください。");
}
export function AnchorExperience() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const liveAnchor = useRef<ReturnType<typeof createLiveTagAnchor> | null>(null);
  const anchorState = useRef<{
    updateCount: number;
    lastTagAtMs: number | null;
    sdkFromVenue: number[] | null;
  }>({ updateCount: 0, lastTagAtMs: null, sdkFromVenue: null });
  const [anchorUpdateCount, setAnchorUpdateCount] = useState(0);
  const adapter = useRef<ReturnType<typeof createTrackingAdapter> | null>(null);
  const diagnostics = useRef(createDiagnostics());
  const inputCapture = useRef<DetectorInputCapture | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const tagState = useRef(createTagLocalizationState());
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [profile, setProfile] = useState<TagProfile | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<"NORMAL" | "LIMITED">("LIMITED");
  const [detection, setDetection] = useState<"waiting" | "preparing" | "active">("waiting");
  const [nowMs, setNowMs] = useState(0);
  const [completionHz, setCompletionHz] = useState<number | null>(null);
  const [normalSinceMs, setNormalSinceMs] = useState<number | null>(null);
  const attempt = useRef(0);
  const log = (event: string, detail: unknown) =>
    diagnostics.current.record(Math.round(performance.now()), event, detail);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        const chosenProfile = selectedTagProfile(window.location.search);
        return {
          profile: chosenProfile,
          config: configureTagBoard(await loadBoardConfig(), chosenProfile),
        };
      })
      .then((value) => {
        if (!active) return;
        setConfig(value.config);
        setProfile(value.profile);
        setStage("ready");
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "設定を読み込めません。");
        setStage("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!config || !canvas.current) return;
    let active = true;
    let running = false;
    let normalSince: number | null = null;
    let detectionActive = false;
    let preparing = false;
    let generation = 0;
    let lastFrameAtMs = -Infinity;
    let resetAtMs = -Infinity;
    const surface = canvas.current;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.round(window.innerWidth * ratio);
      surface.height = Math.round(window.innerHeight * ratio);
      log("display.layout", {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        backingWidth: surface.width,
        backingHeight: surface.height,
      });
    };
    resize();
    window.addEventListener("resize", resize);
    const clearAnchor = (reason: string) => {
      liveAnchor.current?.clear();
      anchorState.current = { ...anchorState.current, lastTagAtMs: null, sdkFromVenue: null };
      log("anchor.cleared", { reason });
    };
    const controller = createTrackingAdapter({
      canvas: surface,
      callbacks: {
        onScene(scene) {
          running = true;
          const marker = config.markers[0]!;
          const anchor = createLiveTagAnchor(scene, marker.sizeMeters, marker.venueFromMarker);
          liveAnchor.current = anchor;
          return () => {
            anchor.dispose();
            if (liveAnchor.current === anchor) liveAnchor.current = null;
          };
        },
        onTracking(status) {
          if (!active) return;
          setTracking(status);
          if (status === "NORMAL") normalSince ??= performance.now();
          else {
            normalSince = null;
            resetAtMs = performance.now();
            clearAnchor("tracking-limited");
          }
          setNormalSinceMs(normalSince);
        },
        onPoseSample(sample) {
          if (active) log("sdk.pose", sample);
        },
        onDiagnostic(event, detail) {
          if (active) {
            log(event, detail);
            if (
              event === "experiment.worker-completed" &&
              detail &&
              typeof detail === "object" &&
              "completionHz" in detail
            ) {
              const value = (detail as { completionHz: unknown }).completionHz;
              setCompletionHz(typeof value === "number" && Number.isFinite(value) ? value : null);
            }
          }
        },
        onReset(reason) {
          if (!active) return;
          clearAnchor(reason);
          normalSince = null;
          setNormalSinceMs(null);
          setTracking("LIMITED");
          if (reason === "tracking-lost") return;
          generation++;
          preparing = false;
          detectionActive = false;
          setDetection("waiting");
          resetAtMs = performance.now();
          tagState.current = createTagLocalizationState();
          if (reason === "stopped") running = false;
          else
            void controller
              .setDetectionEnabled(false)
              .catch((reason) => log("experiment.disable-error", String(reason)));
        },
        onError(reason) {
          if (!active) return;
          setError(reason.message);
          setStage("error");
          log("error", reason.message);
        },
        onDetections(frame, result) {
          if (
            !active ||
            !detectionActive ||
            frame.timestampMs <= resetAtMs ||
            frame.timestampMs <= lastFrameAtMs
          )
            return;
          lastFrameAtMs = frame.timestampMs;
          const marker = config.markers[0]!;
          tagState.current = reduceTagLocalization(
            tagState.current,
            {
              timestampMs: frame.timestampMs,
              intrinsics: frame.intrinsics,
              detections: result.detections,
            },
            {
              markerId: marker.id,
              sizeMeters: marker.sizeMeters,
              venueFromMarker: marker.venueFromMarker,
            },
          );
          inputCapture.current = {
            frame,
            result,
            localization: tagState.current,
            receivedAtMs: performance.now(),
          };
          setCaptureAvailable(true);
          const evaluatedAtMs = performance.now();
          const anchorUpdated =
            liveAnchor.current !== null &&
            tagState.current.status === "tracked" &&
            tagState.current.venueFromCamera !== null &&
            frame.worldFromCamera !== null &&
            frame.timestampMs > resetAtMs &&
            evaluatedAtMs - frame.timestampMs < 500;
          if (anchorUpdated) {
            const sdkFromVenue =
              liveAnchor.current?.update(
                tagState.current.venueFromCamera!,
                frame.worldFromCamera!,
              ) ?? null;
            anchorState.current = {
              updateCount: anchorState.current.updateCount + 1,
              lastTagAtMs: frame.timestampMs,
              sdkFromVenue,
            };
            setAnchorUpdateCount(anchorState.current.updateCount);
          }
          log("fiducial.frame", {
            id: frame.id,
            sourceCallbackAtMs: frame.timestampMs,
            sourceVideoTime: frame.sourceVideoTime,
            captureSessionId: frame.captureSessionId ?? null,
            captureMetadata: frame.metadata ?? null,
            width: frame.width,
            height: frame.height,
            intrinsics: frame.intrinsics,
            sdkFromCamera: frame.worldFromCamera,
            rawTracking: frame.metadata?.trackingInput ?? null,
            sdkPoseAttachment: frame.metadata?.sdkPoseAttachment ?? null,
            result,
            tagLocalization: tagState.current,
            evaluatedAtMs,
            anchorUpdated,
            anchor: anchorState.current,
            displayStabilization: anchorUpdated
              ? (liveAnchor.current?.getDisplayDiagnostic() ?? null)
              : null,
            latencyMs: evaluatedAtMs - frame.timestampMs,
          });
        },
      },
    });
    adapter.current = controller;
    const timer = window.setInterval(() => {
      const timestampMs = performance.now();
      setNowMs(timestampMs);
      if (
        !active ||
        !running ||
        document.hidden ||
        detectionActive ||
        preparing ||
        normalSince === null ||
        timestampMs - normalSince < normalWarmupMs
      )
        return;
      const current = generation;
      const preparedNormalSince = normalSince;
      preparing = true;
      setDetection("preparing");
      void controller
        .setDetectionEnabled(true)
        .then((enabled) => {
          if (!active || current !== generation) return;
          if (enabled && normalSince !== preparedNormalSince) {
            void controller.setDetectionEnabled(false);
            log("experiment.warmup-interrupted", { preparedNormalSince, normalSince });
            enabled = false;
          }
          detectionActive = enabled;
          setDetection(enabled ? "active" : "waiting");
          if (!enabled) {
            normalSince = null;
            setNormalSinceMs(null);
          }
        })
        .catch((reason) => {
          if (!active || current !== generation) return;
          log("experiment.enable-error", { message: String(reason) });
          normalSince = null;
          setNormalSinceMs(null);
          setDetection("waiting");
        })
        .finally(() => {
          if (!active || current !== generation) return;
          preparing = false;
          // Retry only after another complete interval of NORMAL observations.
          if (!detectionActive && !document.hidden) {
            const status =
              controller.getMeasurementSnapshot().trackingDiagnostics.lastUpdate
                ?.appliedTrackingStatus;
            if (status === "NORMAL") {
              normalSince = performance.now();
              setNormalSinceMs(normalSince);
            }
          }
        });
    }, 100);
    return () => {
      active = false;
      generation++;
      attempt.current++;
      window.clearInterval(timer);
      controller.stop();
      adapter.current = null;
      window.removeEventListener("resize", resize);
    };
  }, [config]);

  function changeConditions(size: string) {
    if (!config) return;
    const nextProfile = selectedTagProfile(`?size=${encodeURIComponent(size)}`);
    const nextConfig = configureTagBoard(config, nextProfile);
    inputCapture.current = null;
    setCaptureAvailable(false);
    tagState.current = createTagLocalizationState();
    liveAnchor.current?.clear();
    anchorState.current = { updateCount: 0, lastTagAtMs: null, sdkFromVenue: null };
    setAnchorUpdateCount(0);
    setProfile(nextProfile);
    setConfig(nextConfig);
    const query = new URLSearchParams();
    query.set("size", String(nextProfile.sizeCm));
    window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
    log("experiment.conditions-changed", {
      profile: nextProfile,
      config: nextConfig,
    });
  }
  async function start() {
    const current = ++attempt.current;
    setError(null);
    inputCapture.current = null;
    setCaptureAvailable(false);
    setStage("starting");
    try {
      if (window.isSecureContext === false)
        throw new Error("端末が信頼するHTTPSで開いてください。");
      await requestMotionPermissions();
      if (current !== attempt.current) return;
      log("session.start", {
        mode: "audience-anchor",
        scale: "absolute",
        detectionHz: "maximum",
        normalWaitMs: normalWarmupMs,
        config,
      });
      await adapter.current?.start();
      if (current === attempt.current) setStage("running");
    } catch (reason) {
      if (current !== attempt.current) return;
      adapter.current?.stop();
      setError(reason instanceof Error ? reason.message : "開始できません。");
      setStage("error");
    }
  }
  function stop() {
    attempt.current++;
    adapter.current?.stop();
    setStage("stopped");
  }
  function download(includeImage = false) {
    const capture = includeImage ? inputCapture.current : null;
    if (includeImage && !capture) return;
    let detectorInput;
    try {
      detectorInput = capture ? serializeDetectorInput(capture) : undefined;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "画像保存に失敗しました。");
      return;
    }
    const payload = {
      schemaVersion: 21,
      poseEstimatorPolicy,
      ...(detectorInput ? { detectorInput } : {}),
      mode: "audience-anchor",
      sdkScale: "absolute",
      experiment: {
        detectionHz: "maximum",
        normalWaitMs: normalWarmupMs,
        presentation: "live-tag-update-with-sdk-hold",
        anchorUpdate: "every-valid-single-tag-pose-immediate",
        anchorHold: "sdk-world-until-next-valid-tag",
        trackingLoss: "hide-and-require-new-tag",
        detectorExecution: "april-only",
        pixelTransport: "transfer-and-return",
        anchorSmoothing: false,
        displayStabilization: displayJitterPolicy,
        outlierWait: false,
        exposurePoseSynchronization: "unknown",
      },
      recordedAt: new Date().toISOString(),
      environment: { userAgent: navigator.userAgent, secureContext: window.isSecureContext },
      detector: "april",
      board: config,
      profile,
      detectorImplementations,
      engineVersion: "@8thwall/engine-binary@1.0.0",
      tagLocalization: tagState.current,
      anchor: anchorState.current,
      measurementSnapshot: adapter.current?.getMeasurementSnapshot() ?? null,
      ...diagnostics.current.snapshot(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = includeImage
      ? `audience-anchor-input-s${capture!.frame.captureSessionId ?? 0}-f${capture!.frame.id}.json`
      : "audience-anchor-tracking-log.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const active = stage === "running" || stage === "starting";
  const waitSeconds = normalSinceMs === null ? 5 : Math.max(0, 5 - (nowMs - normalSinceMs) / 1000);
  const status =
    tracking !== "NORMAL"
      ? "SDKのNORMALを待っています（位置表示は停止中）"
      : detection === "active"
        ? `タグ即更新・SDKで保持・最大速度${completionHz === null ? "" : `（実効${completionHz.toFixed(1)}Hz）`}`
        : detection === "preparing"
          ? "検出器を準備中"
          : `検出開始まで約${waitSeconds.toFixed(1)}秒`;
  return (
    <main className={active ? "experience active" : "experience"}>
      <canvas
        ref={canvas}
        className="camera"
        aria-label="カメラ映像とタグ位置をSDKで保持するライブ表示"
      />
      <header className="topbar">
        <a className="brand" href="/">
          unframe<span>audience</span>
        </a>
        <span className="poc-badge">
          <i />
          タグ即更新・SDK保持
        </span>
      </header>
      <section className="intro" aria-labelledby="experience-title">
        <h1 id="experience-title">{active ? status : "タグで位置を更新し、SDKでつなぐ。"}</h1>
        <p className="description">
          タグ位置を1回で即採用し、次のタグ更新まではSDKの移動で表示をつなぎます。
        </p>
      </section>
      <section className="control-panel" aria-label="視聴の操作">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {config && (
          <p role="status">
            {active ? "実行設定" : "開始する設定"}： AprilTag 3 · tag36h11 ／ 黒い外周{" "}
            {(config.markers[0]!.sizeMeters * 100).toFixed(1)}cm
          </p>
        )}
        {!active && config && (
          <div className="experiment-controls">
            <label>
              設置外寸
              <select
                name="size"
                value={profile?.sizeCm ?? 22.5}
                onChange={(event) => changeConditions(event.target.value)}
              >
                <option value="22.5">22.5 cm（黒い外周15 cm）</option>
                <option value="36">36 cm（黒い外周24 cm）</option>
                <option value="50">50 cm</option>
                <option value="60">60 cm</option>
                <option value="70">70 cm</option>
              </select>
            </label>
            <p className="hint">
              選択はすぐに反映されます。AprilTag用のマーカー画像を使用してください。
            </p>
          </div>
        )}
        {active && (
          <>
            <p className="hint">
              タグ位置の採用 {anchorUpdateCount}回 ·{" "}
              {anchorState.current.lastTagAtMs === null
                ? "初回タグ待ち"
                : `最終更新から${(Math.max(0, nowMs - anchorState.current.lastTagAtMs) / 1000).toFixed(1)}秒（SDKで保持）`}
            </p>
            <p className="hint">タグ検出：{tagState.current.reason}</p>
            <div className="tracking-status" role="status">
              <span className={tracking === "NORMAL" ? "status-dot locked" : "status-dot"} />
              <span>{status}</span>
              <span className="tracking-quality">SDK {tracking}</span>
            </div>
            <button className="secondary" onClick={stop}>
              停止
            </button>
          </>
        )}
        {!active && (
          <button className="primary" disabled={!config} onClick={() => void start()}>
            カメラを開始<span aria-hidden="true">↗</span>
          </button>
        )}
        <div className="setup-info">
          <span>
            黒いマーカー外周{" "}
            <strong>{config ? config.markers[0]!.sizeMeters * 100 : "—"} cm</strong>
          </span>
          <a
            href={`/print-target.html?size=${profile?.sizeCm ?? 22.5}`}
            target="_blank"
            rel="noreferrer"
          >
            マーカーを表示・印刷
          </a>
        </div>
        <p className="hint">
          有効なタグ姿勢は1回で即採用します。未検出・姿勢が曖昧な間は前の位置をSDKで保持し、SDK追跡低下時は非表示にして新しいタグ姿勢を待ちます。NORMALが5秒続くと検出を自動開始します。画像解像度を維持し、AprilTag検出を処理完了ごとに実行します。表示Hzは実測値で、端末や発熱によって変わります。
        </p>
        <button className="text-button" onClick={() => download()}>
          JSONログを保存
        </button>
        <button className="text-button" disabled={!captureAvailable} onClick={() => download(true)}>
          検出入力画像付きJSONを保存
        </button>
        <p className="hint">
          最後に結果が返った検出画像を1枚、縮小・枠・軸なしでJSONへ含めます。未検出0件でも保存できます。周囲の映り込みを含む画像が端末へ保存されます。自動送信はしません。検出結果がまだ返っていない場合は保存できません。
        </p>
        <details className="diagnostics">
          <summary>検証情報とライセンス</summary>
          <p>
            タグ確定の平滑化・複数回待機は行いません。表示だけ、距離に応じて位置10〜20mm・回転0.5〜1°以内の小揺れを抑え、それを超えた変化は即反映します。背景の箱と軸がライブ表示です。画像とSDK姿勢は同じSDKコールバックから取得しますが、センサー露光時刻との同期は未確認です。
          </p>
          <p>XR Engine: Niantic Spatial, Inc. Copyright © 2026. All rights reserved.</p>
          <a href="/external/xr/LICENSE">XR Engine License Agreement</a>
          <p>専用検出器と辞書のライセンス・取得元:</p>
          <a href="/external/detectors/LICENSE.wrapper">AprilTag wrapper BSD-3</a>
          <br />
          <a href="/external/detectors/LICENSE.apriltag">AprilTag BSD-2</a>
          <br />
          <a href="/external/detectors/LICENSE.posit">POSIT・SVD MIT</a>
          <br />
          <a href="/external/detectors/apriltag_36h11.js">AprilTag dictionary BSD-3</a>
          <br />
          <a href="/external/detectors/provenance.json">AprilTag取得元・SHA-256</a>
          <br />
          <a href="/external/engine-manifest.json">XR Engine配布物ハッシュ</a>
        </details>
      </section>
      <footer className="footer">
        <span>UNFRAME / XR EXPERIMENT</span>
        <span>実機精度は検証中</span>
      </footer>
    </main>
  );
}
