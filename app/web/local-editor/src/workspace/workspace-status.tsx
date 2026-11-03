import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { previewStatusLabel } from "../preview/preview-state";
export function WorkspaceStatus() {
  const w = useWorkspace();
  const p = useStore(w.project.store, (s) => s.project);
  const edit = useStore(w.project.store, (s) => s.status);
  const view = useStore(w.preview.store);
  return (
    <footer className="workspace-status">
      <span className={`status-dot ${view.status}`} />
      <span>{previewStatusLabel(view)}</span>
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
      {view.displayed?.channel === "dev" && view.displayed.sourceRevision !== p?.revision && (
        <strong>Source と表示が異なります</strong>
      )}
      <details>
        <summary>表示情報</summary>
        <dl>
          <dt>Source revision</dt>
          <dd>{p?.revision ?? "未取得"}</dd>
          <dt>表示 revision</dt>
          <dd>{view.displayed?.sourceRevision ?? "一致未検証"}</dd>
          <dt>Build</dt>
          <dd>{view.displayed?.buildIdentity ?? "未表示"}</dd>
          <dt>Request</dt>
          <dd>{view.displayed?.requestId ?? "なし"}</dd>
        </dl>
      </details>
    </footer>
  );
}
