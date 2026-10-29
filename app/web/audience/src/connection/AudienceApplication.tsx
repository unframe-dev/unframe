import { createSessionRecorder, downloadSessionDiagnostic } from "../diagnostics/session-recorder";
import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { JoinExperience } from "./JoinExperience";
import { readConnectionConfig } from "./application-config";
import { createAudienceRealtime } from "./realtime-client";
import { createAnonymousAudienceClient } from "./anonymous-client";
import {
  createJoinController,
  type JoinSnapshot,
  type PreparedConnection,
} from "./join-controller";
import type { createTrackingAdapter } from "../tracking/adapter";
import type { ViewingSnapshot } from "../experience/viewing-session";

const ViewerExperience = lazy(() =>
  import("../experience/ViewerExperience").then((module) => ({ default: module.ViewerExperience })),
);

const idleStore = createStore<JoinSnapshot>(() => ({ phase: "idle" }));

export function AudienceApplication(
  props: {
    trackingAdapter?: typeof createTrackingAdapter;
    onViewingSnapshot?(snapshot: ViewingSnapshot): void;
  } = {},
) {
  const [recorder] = useState(() => createSessionRecorder());
  const [state] = useState(() => {
    const settings = readConnectionConfig(import.meta.env);
    return {
      invalid: settings.status === "invalid",
      controller:
        settings.status === "configured"
          ? createJoinController({
              recorder,
              client: createAnonymousAudienceClient(settings.config),
              capabilityProfileId: settings.config.capabilityProfileId,
            })
          : null,
    };
  });
  const [realtime] = useState(() => createAudienceRealtime({ recorder }));
  useEffect(
    () => () => {
      state.controller?.dispose();
      realtime.dispose();
    },
    [state, realtime],
  );
  useEffect(() => {
    const checkExpiry = () => {
      if (!document.hidden) state.controller?.getPrepared();
    };
    document.addEventListener("visibilitychange", checkExpiry);
    return () => document.removeEventListener("visibilitychange", checkExpiry);
  }, [state]);
  const snapshot = useStore(state.controller?.store ?? idleStore, (value) => value);
  const [connection, setConnection] = useState<PreparedConnection | null>(null);
  const revision = snapshot.phase === "prepared" ? snapshot.revision : null;
  useEffect(() => {
    if (snapshot.phase === "recovering") return;
    setConnection(revision === null ? null : (state.controller?.getPrepared() ?? null));
  }, [revision, snapshot.phase, state]);
  useEffect(() => {
    if (snapshot.phase === "ended")
      props.onViewingSnapshot?.({ phase: "ended", runtime: null, recovery: null, error: null });
    else if (snapshot.phase === "error")
      props.onViewingSnapshot?.({
        phase: "error",
        runtime: null,
        recovery: null,
        error: snapshot.error,
      });
  }, [snapshot, props.onViewingSnapshot]);
  if (
    (snapshot.phase === "prepared" || snapshot.phase === "recovering") &&
    state.controller &&
    connection
  )
    return (
      <Suspense fallback={<p role="status">視聴画面を準備しています。</p>}>
        <ViewerExperience
          recorder={recorder}
          connection={connection}
          onRuntimeInput={realtime.install}
          onRecoveryRequest={realtime.recover}
          onReconnect={state.controller.reconnect}
          {...(props.trackingAdapter ? { trackingAdapter: props.trackingAdapter } : {})}
          {...(props.onViewingSnapshot ? { onViewingSnapshot: props.onViewingSnapshot } : {})}
          recovering={snapshot.phase === "recovering"}
          refreshing={snapshot.phase === "prepared" ? snapshot.refreshing : true}
          refreshError={snapshot.phase === "prepared" ? snapshot.refreshError : null}
          onRefresh={() => {
            void state.controller?.refresh();
          }}
          onLeave={state.controller.leave}
        />
      </Suspense>
    );
  return (
    <>
      {state.invalid && (
        <p role="alert">現在ルームに接続できません。会場スタッフにご確認ください。</p>
      )}
      <JoinExperience controller={state.controller} />
      <button onClick={() => downloadSessionDiagnostic(recorder)}>接続テストログを保存</button>
      {import.meta.env.DEV && (
        <nav className="audience-development-links" aria-label="開発用テスト">
          <a href="?fixture=1">fixture表示テスト</a>
          <a href="?tracking=1">タグ位置合わせテスト</a>
        </nav>
      )}
    </>
  );
}
