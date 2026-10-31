import { Link } from "@tanstack/react-router";
import { useRef, useSyncExternalStore } from "react";
import { Button } from "@/shared/ui/button";
import styles from "@/app/shell/application-content.module.css";
import { type PublicationState } from "./publication-controller";
import { usePublicationController } from "./publication-context";

function assetSize(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString("ja-JP")} B`;
  const unit = bytes < 1024 * 1024 ? "KiB" : "MiB";
  const value = bytes / (unit === "KiB" ? 1024 : 1024 * 1024);
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} ${unit}`;
}

function progressMessage(state: PublicationState) {
  if (state.status === "reading") return "Dist を検証しています…";
  if (state.status === "checking") return "公開先を確認しています…";
  if (state.status === "resolving") return "公開結果を確認しています…";
  if (state.status !== "publishing") return "";
  switch (state.progress?.stage) {
    case "uploading":
      return `素材をアップロードしています… ${state.progress.uploadedAssets} / ${state.progress.totalAssets}`;
    case "publishing":
      return "公開を確定しています…";
    default:
      return "公開を準備しています…";
  }
}

export function PublicationPage() {
  const controller = usePublicationController();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const blocked =
    state.status === "publishing" || state.status === "uncertain" || state.status === "resolving";
  const selection = "selection" in state ? state.selection : undefined;
  const progress = progressMessage(state);

  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>プレゼンテーションを公開</h1>
      </header>
      <section className="grid max-w-2xl gap-6 py-8" aria-label="Dist の公開">
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={blocked} onClick={() => input.current?.click()}>
            {selection ? "Dist フォルダを選び直す" : "Dist フォルダを選択"}
          </Button>
          <input
            ref={(element) => {
              input.current = element;
              element?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            hidden
            multiple
            disabled={blocked}
            aria-label="Dist フォルダ"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void controller.choose(files);
            }}
          />
          {state.status === "reading" || state.status === "checking" ? (
            <Button variant="ghost" onClick={controller.cancel}>
              中止
            </Button>
          ) : null}
        </div>

        {progress ? <p role="status">{progress}</p> : null}
        {state.status === "error" || state.status === "uncertain" ? (
          <div className="grid gap-4">
            <p role="alert">{state.message}</p>
            {state.status === "uncertain" || state.dist ? (
              <div>
                <Button variant="outline" onClick={() => void controller.recheck()}>
                  {state.status === "uncertain" ? "公開情報を確認" : "公開先を再確認"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {selection ? (
          <div className="grid gap-5 border-y py-6">
            <h2 className="break-words text-2xl">
              {selection.dist.artifacts.definition.metadata.title}
            </h2>
            {state.status === "ready" ? (
              <p>
                {selection.target.publication
                  ? "公開済みプレゼンテーションを更新します。"
                  : "新規公開します。"}
              </p>
            ) : null}
            {selection.target.presentation &&
            selection.target.presentation.name !==
              selection.dist.artifacts.definition.metadata.title ? (
              <p>更新先：{selection.target.presentation.name}</p>
            ) : null}
            <p className="text-sm text-[var(--muted)]">
              素材 {selection.dist.assetCount} 件・{assetSize(selection.dist.totalAssetBytes)}
            </p>
            <details className="text-sm">
              <summary className="w-fit cursor-pointer text-[var(--muted)]">技術情報</summary>
              <dl className="mt-4 grid gap-3 break-all">
                <div>
                  <dt>Presentation ID</dt>
                  <dd>{selection.dist.artifacts.buildManifest.presentationId}</dd>
                </div>
                <div>
                  <dt>Build ID</dt>
                  <dd>{selection.dist.artifacts.buildManifest.buildId}</dd>
                </div>
              </dl>
            </details>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <div>
            <Button
              className="bg-[var(--accent-ink)] hover:bg-[var(--night-soft)]"
              onClick={() => void controller.publish()}
            >
              公開する
            </Button>
          </div>
        ) : null}
        {state.status === "publishing" ? (
          <div>
            <Button disabled>公開しています…</Button>
          </div>
        ) : null}
        {state.status === "published" ? (
          <div className="grid gap-4">
            <p role="status">
              {state.alreadyPublished ? "この Dist はすでに公開されています。" : "公開しました。"}
            </p>
            <div className="flex flex-wrap gap-5">
              <Link
                to="/presentations/$presentationId"
                params={{
                  presentationId: state.selection.dist.artifacts.buildManifest.presentationId,
                }}
              >
                プレゼンテーションを開く
              </Link>
              <Link to="/home">一覧へ戻る</Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
