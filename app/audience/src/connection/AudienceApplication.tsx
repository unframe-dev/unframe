import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { JoinExperience } from "./JoinExperience";
import { readConnectionConfig } from "./application-config";
import { createAudienceRealtime } from "./realtime-client";
import { createAnonymousAudienceClient } from "./anonymous-client";
import { createJoinController, type PreparedConnection } from "./join-controller";

const ViewerExperience = lazy(() =>
  import("../experience/ViewerExperience").then((module) => ({ default: module.ViewerExperience })),
);

const idleSnapshot = { phase: "idle" } as const;
const idleSubscribe = () => () => {};
const getIdleSnapshot = () => idleSnapshot;

export function AudienceApplication() {
  const [state] = useState(() => {
    const settings = readConnectionConfig(import.meta.env);
    return {
      invalid: settings.status === "invalid",
      controller:
        settings.status === "configured"
          ? createJoinController({
              client: createAnonymousAudienceClient(settings.config),
              capabilityProfileId: settings.config.capabilityProfileId,
            })
          : null,
    };
  });
  const [realtime] = useState(() => createAudienceRealtime());
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
  const snapshot = useSyncExternalStore(
    state.controller?.subscribe ?? idleSubscribe,
    state.controller?.getSnapshot ?? getIdleSnapshot,
  );
  const [connection, setConnection] = useState<PreparedConnection | null>(null);
  const revision = snapshot.phase === "prepared" ? snapshot.revision : null;
  useEffect(() => {
    setConnection(revision === null ? null : (state.controller?.getPrepared() ?? null));
  }, [revision, state]);
  if (snapshot.phase === "prepared" && state.controller && connection)
    return (
      <Suspense fallback={<p role="status">視聴画面を準備しています。</p>}>
        <ViewerExperience
          connection={connection}
          onRuntimeInput={realtime.install}
          onRecoveryRequest={realtime.recover}
          refreshing={snapshot.refreshing}
          refreshError={snapshot.refreshError}
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
      {import.meta.env.DEV && (
        <nav className="audience-development-links" aria-label="開発用テスト">
          <a href="?fixture=1">fixture表示テスト</a>
          <a href="?tracking=1">タグ位置合わせテスト</a>
        </nav>
      )}
    </>
  );
}
