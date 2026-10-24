import { useEffect, useState, useSyncExternalStore } from "react";
import { AnchorExperience } from "../AnchorExperience";
import { JoinExperience } from "./JoinExperience";
import { readConnectionConfig } from "./application-config";
import { createAudienceHttpClient } from "./http-client";
import { createJoinController } from "./join-controller";

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
              client: createAudienceHttpClient(settings.config),
              capabilityProfileId: settings.config.capabilityProfileId,
            })
          : null,
    };
  });
  useEffect(() => () => state.controller?.dispose(), [state]);
  const snapshot = useSyncExternalStore(
    state.controller?.subscribe ?? idleSubscribe,
    state.controller?.getSnapshot ?? getIdleSnapshot,
  );
  if (snapshot.phase === "prepared" && state.controller)
    return <AnchorExperience viewerMode onLeave={state.controller.leave} />;
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
