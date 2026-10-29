import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "zustand";
import { JoinExperience } from "./JoinExperience";
import { createAudienceSession } from "./audience-session";
import { readSharedJoinCode } from "./shared-join-code";
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
  const [sharedJoin] = useState(() => ({
    fragment: window.location.hash,
    code: readSharedJoinCode(window.location.hash),
  }));
  const [application] = useState(() =>
    createAudienceSession({ environment: import.meta.env, ...props }),
  );
  useEffect(() => {
    if (window.location.hash === sharedJoin.fragment) {
      const fragment = new URLSearchParams(sharedJoin.fragment.slice(1));
      if (fragment.has("join")) {
        fragment.delete("join");
        const remaining = fragment.toString();
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`,
        );
      }
    }
    application.start();
    return application.dispose;
  }, [application, sharedJoin]);
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
      <JoinExperience controller={application.controller} initialJoinCode={sharedJoin.code} />
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
