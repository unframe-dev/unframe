import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
const phaseLabels = {
  idle: "待機中",
  building: "build 中",
  preparing: "表示を準備中",
  committing: "表示を交換中",
  confirming: "表示を確認中",
  ready: "表示確認済み",
  failed: "表示失敗",
};
const labels = {
  idle: "待機中",
  loading: "表示を準備中",
  ready: "表示確認済み",
  recovering: "表示を復旧中",
  "reload-required": "再読込が必要",
  error: "表示失敗",
};
export function WorkspaceStatus() {
  const w = useWorkspace();
  const p = useStore(w.project.store, (s) => s.project);
  const edit = useStore(w.project.store, (s) => s.status);
  const view = useStore(w.preview.store);
  return (
    <footer className="workspace-status">
      <span className={`status-dot ${view.status}`} />
      <span>{view.status === "loading" ? phaseLabels[view.phase] : labels[view.status]}</span>
      {view.error && (
        <span role="alert" className="status-error">
          {view.error}
        </span>
      )}
      <span className="spacer" />
      <span>
        {edit === "clean"
          ? "保存済み"
          : edit === "dirty"
            ? "未保存"
            : edit === "saving"
              ? "保存中"
              : edit === "conflict"
                ? "保存競合"
                : "保存結果未確認"}
      </span>
      {view.loaded?.channel === "dev" && view.loaded.sourceRevision !== p?.revision && (
        <strong>Source と表示が異なります</strong>
      )}
      <details>
        <summary>表示情報</summary>
        <dl>
          <dt>Source revision</dt>
          <dd>{p?.revision ?? "未取得"}</dd>
          <dt>表示 revision</dt>
          <dd>{view.loaded?.sourceRevision ?? "一致未検証"}</dd>
          <dt>Build</dt>
          <dd>{view.loaded?.buildIdentity ?? "未表示"}</dd>
          <dt>Request</dt>
          <dd>{view.loaded?.requestId ?? "なし"}</dd>
        </dl>
      </details>
    </footer>
  );
}
