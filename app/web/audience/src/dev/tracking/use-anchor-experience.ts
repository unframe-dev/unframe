import { useEffect, useRef, useState } from "react";
import { configureTagBoard, loadBoardConfig, selectedTagProfile } from "../../fiducials/config";
import { createDiagnostics } from "../../tracking/diagnostics";
import { createAnchorSession, type AnchorSessionSnapshot } from "../../experience/anchor-session";
import { downloadAnchorDiagnostics } from "./diagnostic-export";
import type { BoardConfig, TagProfile } from "../../fiducials/config";
import type { AnchorExperienceViewProps } from "./AnchorExperienceView";

export function useAnchorExperience({
  showGuides = true,
  mode = "tracking",
}: { showGuides?: boolean; mode?: "tracking" | "viewer" } = {}): AnchorExperienceViewProps {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<ReturnType<typeof createAnchorSession> | null>(null);
  const diagnostics = useRef(createDiagnostics());
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [profile, setProfile] = useState<TagProfile | null>(null);
  const [snapshot, setSnapshot] = useState<AnchorSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setConfig(null);
    setProfile(null);
    setSnapshot(null);
    setError(null);
    void Promise.resolve()
      .then(async () => {
        const board = await loadBoardConfig();
        if (mode === "viewer") return { profile: null, config: board };
        const chosen = selectedTagProfile(window.location.search);
        return { profile: chosen, config: configureTagBoard(board, chosen) };
      })
      .then((value) => {
        if (!active) return;
        setProfile(value.profile);
        setConfig(value.config);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "設定を読み込めません。");
      });
    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!config || !canvas.current) return;
    const current = createAnchorSession({
      canvas: canvas.current,
      config,
      diagnostics: diagnostics.current,
      onChange: setSnapshot,
      showGuides,
    });
    session.current = current;
    setSnapshot(current.getSnapshot());
    return () => {
      current.dispose();
      if (session.current === current) session.current = null;
    };
  }, [config, showGuides]);

  function changeSize(size: string) {
    if (mode !== "tracking" || !config) return;
    const nextProfile = selectedTagProfile(`?size=${encodeURIComponent(size)}`);
    const nextConfig = configureTagBoard(config, nextProfile);
    setError(null);
    setProfile(nextProfile);
    setConfig(nextConfig);
    const query = new URLSearchParams(window.location.search);
    query.set("size", String(nextProfile.sizeCm));
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
    diagnostics.current.record(Math.round(performance.now()), "experiment.conditions-changed", {
      profile: nextProfile,
      config: nextConfig,
    });
  }
  function download(includeImage = false) {
    try {
      downloadAnchorDiagnostics({
        session: session.current,
        diagnostics: diagnostics.current,
        config,
        profile,
        includeImage,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "画像保存に失敗しました。");
    }
  }
  return {
    mode,
    canvasRef: canvas,
    stage: snapshot?.stage ?? (error ? "error" : "loading"),
    error: error ?? snapshot?.error ?? null,
    config,
    profile,
    tracking: snapshot?.tracking ?? "LIMITED",
    detection: snapshot?.detection ?? "waiting",
    nowMs: snapshot?.nowMs ?? 0,
    normalSinceMs: snapshot?.normalSinceMs ?? null,
    completionHz: snapshot?.completionHz ?? null,
    anchorUpdateCount: snapshot?.anchorUpdateCount ?? 0,
    lastTagAtMs: snapshot?.lastTagAtMs ?? null,
    localizationReason: snapshot?.localizationReason ?? "not-detected",
    captureAvailable: snapshot?.captureAvailable ?? false,
    ...(snapshot?.sdkProgress ? { sdkProgress: snapshot.sdkProgress } : {}),
    onChangeSize: changeSize,
    onStart() {
      setError(null);
      void session.current?.start();
    },
    onStop() {
      session.current?.stop();
    },
    onDownload: download,
  };
}
