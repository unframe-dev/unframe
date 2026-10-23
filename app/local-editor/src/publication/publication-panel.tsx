import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
import { Modal } from "../ui/dialog";
export function PublicationPanel() {
  const w = useWorkspace();
  const open = useStore(w.ui, (s) => s.publicationOpen);
  const p = useStore(w.project.store);
  const s = useStore(w.publication.store);
  const job = s.job;
  const building = job && ["queued", "running"].includes(job.status);
  return (
    <Modal
      title="公開前確認"
      open={open}
      onOpenChange={(publicationOpen) => w.ui.setState({ publicationOpen })}
    >
      <div className="publication-panel">
        <p>本番 build を表示して確認してから公開します。</p>
        <Button
          disabled={!p.project || p.status !== "clean" || !!building}
          onClick={() => void w.commands.buildDist()}
        >
          本番 build
        </Button>
        {building && <Button onClick={() => void w.publication.cancelBuild()}>build を中止</Button>}
        {job && <p>本番 build: {job.status}</p>}
        {!s.receipt && <p className="muted">固定 Dist の表示確認が完了すると公開できます。</p>}
        {s.auth?.status === "unconfigured" && <p>Local Host の公開先が設定されていません。</p>}
        {s.auth?.status === "pending" && (
          <div>
            <p>
              確認コード: <strong>{s.auth.userCode}</strong>
            </p>
            {s.auth.verificationUrl && (
              <a href={s.auth.verificationUrl} target="_blank" rel="noopener noreferrer">
                認証ページを開く
              </a>
            )}
            <Button disabled={s.pending} onClick={() => void w.publication.cancelAuth()}>
              認証を取り消す
            </Button>
          </div>
        )}
        {s.auth?.status === "expired" && <p>認証期限が切れました。認証を開始し直してください。</p>}
        {s.auth?.status === "denied" && <p>認証が拒否されました。</p>}
        <Button
          className="primary"
          disabled={
            !s.receipt ||
            s.pending ||
            !s.auth ||
            s.auth.status === "unconfigured" ||
            s.auth.status === "pending" ||
            s.result?.requestId === s.receipt.requestId
          }
          onClick={() =>
            void (s.auth?.status === "authenticated"
              ? w.commands.publish()
              : w.publication.authenticate())
          }
        >
          {s.pending
            ? "処理中…"
            : s.auth?.status === "authenticated"
              ? "表示した Dist を公開"
              : "公開の認証を開始"}
        </Button>
        {s.error && <p role="alert">{s.error}</p>}
        {s.result && (
          <p role="status">
            公開完了: {s.result.buildId}（epoch {s.result.publicationEpoch}）
          </p>
        )}
      </div>
    </Modal>
  );
}
