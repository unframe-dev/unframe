import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { JoinExperience } from "./JoinExperience";
import { createAudienceSession } from "./audience-session";
import type { createTrackingAdapter } from "../tracking/adapter";
import type { ViewingSnapshot } from "../experience/viewing-session";

const ViewerExperience = lazy(() =>
  import("../experience/ViewerExperience").then((module) => ({ default: module.ViewerExperience })),
);

export function AudienceApplication(
  props: {
    trackingAdapter?: typeof createTrackingAdapter;
    onViewingSnapshot?(snapshot: ViewingSnapshot): void;
  } = {},
) {
  const [application] = useState(() =>
    createAudienceSession({ environment: import.meta.env, ...props }),
  );
  useEffect(() => {
    application.start();
    return application.dispose;
  }, [application]);
  const screen = useStore(application.store, (state) => state.screen);
  const invalid = useStore(application.store, (state) => state.invalid);
  const loadError = useStore(application.store, (state) => state.loadError);
  const viewer = screen === "viewer" ? application.getViewer() : null;
  if (screen === "loading") return <p role="status">視聴画面を準備しています。</p>;
  if (viewer)
    return (
      <Suspense fallback={<p role="status">視聴画面を準備しています。</p>}>
        <ViewerExperience application={viewer} />
      </Suspense>
    );
  return (
    <>
      {invalid && <p role="alert">現在ルームに接続できません。会場スタッフにご確認ください。</p>}
      {loadError && (
        <p role="alert">視聴画面を読み込めません。通信環境を確認し、もう一度参加してください。</p>
      )}
      <JoinExperience controller={application.controller} />
      <button onClick={application.downloadDiagnostic}>接続テストログを保存</button>
      {import.meta.env.DEV && (
        <nav className="audience-development-links" aria-label="開発用テスト">
          <a href="?fixture=1">fixture表示テスト</a>
          <a href="?tracking=1">タグ位置合わせテスト</a>
        </nav>
      )}
    </>
  );
}
