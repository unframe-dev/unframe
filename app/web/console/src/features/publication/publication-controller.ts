import {
  PublicationRequestError,
  type createPublicationClient,
  type PublicationProgress,
  type PublicationTarget,
} from "@unframe-dev/api-client-typescript/publication";
import { verifyPublicationIntegrity } from "@unframe-dev/artifacts";
import {
  BrowserDistError,
  readBrowserDist,
  type BrowserDistFile,
  type BrowserDistSnapshot,
} from "./read-dist";

type Selection = { dist: BrowserDistSnapshot; target: PublicationTarget };
type PublishedResult = { presentationId: string; buildId: string; publicationEpoch: number };
type PendingPublication = { selection: Selection; presentationId?: string };
export type PublicationState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "checking"; dist: BrowserDistSnapshot }
  | ({ status: "resolving" } & PendingPublication)
  | { status: "ready"; selection: Selection }
  | { status: "publishing"; selection: Selection; progress?: PublicationProgress }
  | {
      status: "published";
      selection: Selection;
      result: PublishedResult;
      alreadyPublished: boolean;
    }
  | { status: "error"; message: string; dist?: BrowserDistSnapshot }
  | ({ status: "uncertain"; message: string } & PendingPublication);

export function publicationErrorMessage(error: unknown): string {
  if (error instanceof BrowserDistError) {
    switch (error.code) {
      case "dist-empty":
        return "Dist フォルダを選択してください。";
      case "dist-file-missing":
        return "Dist に必要なファイルがありません。ビルドした dist フォルダを選択してください。";
      case "dist-file-too-large":
        return "Dist のサイズが上限を超えています。素材は合計256 MiBまでです。";
      case "dist-cancelled":
        return "読み込みを中止しました。";
      case "dist-file-read-failed":
        return "ファイルを読み込めませんでした。Dist フォルダを選び直してください。";
      default:
        return "Dist の内容を検証できませんでした。もう一度ビルドして選び直してください。";
    }
  }
  const status = error instanceof PublicationRequestError ? error.status : undefined;
  if (status === 401) return "ログインの有効期限が切れました。ログインし直してください。";
  if (status === 403) return "このプレゼンテーションを公開する権限がありません。";
  if (status === 409)
    return "公開状態が変わったか、未終了のルームがあります。ルームを確認し、公開先を再確認してください。";
  return "公開処理を完了できませんでした。接続を確認し、公開先を再確認してください。";
}

export function createPublicationController(client: ReturnType<typeof createPublicationClient>) {
  let state: PublicationState = { status: "idle" };
  const listeners = new Set<() => void>();
  let operation = 0;
  let active: AbortController | undefined;
  const update = (next: PublicationState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const begin = () => {
    active?.abort();
    active = new AbortController();
    return { id: ++operation, signal: active.signal };
  };
  const check = async (dist: BrowserDistSnapshot, task: ReturnType<typeof begin>) => {
    update({ status: "checking", dist });
    try {
      const target = await client.getSourceTarget(dist.artifacts.buildManifest.presentationId, {
        signal: task.signal,
      });
      if (task.id !== operation) return;
      const selection = { dist, target };
      if (target.publication?.buildId === dist.artifacts.buildManifest.buildId) {
        if (
          !verifyPublicationIntegrity({
            ...dist.artifacts,
            publishedPresentation: target.publication,
          }).valid
        )
          throw new PublicationRequestError("publication-target-invalid");
        update({
          status: "published",
          selection,
          result: target.publication,
          alreadyPublished: true,
        });
      } else update({ status: "ready", selection });
    } catch (error) {
      if (task.id === operation)
        update({ status: "error", dist, message: publicationErrorMessage(error) });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async choose(files: readonly BrowserDistFile[]) {
      if (
        state.status === "publishing" ||
        state.status === "uncertain" ||
        state.status === "resolving" ||
        files.length === 0
      )
        return;
      const task = begin();
      update({ status: "reading" });
      try {
        const dist = await readBrowserDist(files, { signal: task.signal });
        if (task.id === operation) await check(dist, task);
      } catch (error) {
        if (task.id === operation)
          update({ status: "error", message: publicationErrorMessage(error) });
      }
    },
    async recheck() {
      if (state.status === "uncertain") {
        const { selection, presentationId } = state;
        const pending = { selection, ...(presentationId ? { presentationId } : {}) };
        const task = begin();
        update({ status: "resolving", ...pending });
        try {
          const options = { signal: task.signal };
          const confirmedId = presentationId ?? selection.target.presentation?.id;
          const target = confirmedId
            ? await client.getTarget(confirmedId, options)
            : await client.getSourceTarget(
                selection.dist.artifacts.buildManifest.presentationId,
                options,
              );
          if (task.id !== operation) return;
          if (
            target.publication?.buildId === selection.dist.artifacts.buildManifest.buildId &&
            target.publication.publicationEpoch ===
              (selection.target.expectedPublicationFence?.publicationEpoch ?? 0) + 1 &&
            verifyPublicationIntegrity({
              ...selection.dist.artifacts,
              publishedPresentation: target.publication,
            }).valid
          ) {
            update({
              status: "published",
              selection: { ...selection, target },
              result: target.publication,
              alreadyPublished: true,
            });
          } else
            update({
              status: "uncertain",
              ...pending,
              message: "まだ公開結果を確認できません。時間をおいて、公開情報を再確認してください。",
            });
        } catch (error) {
          if (task.id === operation)
            update({
              status: "uncertain",
              ...pending,
              message: `公開結果を確認できません。${publicationErrorMessage(error)}`,
            });
        }
        return;
      }
      const dist =
        state.status === "ready"
          ? state.selection.dist
          : state.status === "error"
            ? state.dist
            : undefined;
      if (dist) await check(dist, begin());
    },
    async publish() {
      if (state.status !== "ready") return;
      const { selection } = state;
      const task = begin();
      update({ status: "publishing", selection });
      try {
        const result = await client.publish({
          artifacts: selection.dist.artifacts,
          readAsset: selection.dist.readAsset,
          expectedPublicationFence: selection.target.expectedPublicationFence,
          ...(selection.target.presentation
            ? { expectedPresentationId: selection.target.presentation.id }
            : {}),
          signal: task.signal,
          onProgress(progress) {
            if (task.id === operation) update({ status: "publishing", selection, progress });
          },
        });
        if (task.id !== operation) return;
        if (result.ok) update({ status: "published", selection, result, alreadyPublished: false });
        else if (result.outcome === "unknown")
          update({
            status: "uncertain",
            selection,
            presentationId: result.presentationId,
            message:
              "公開結果を確認できません。公開された可能性があるため、公開情報を確認してください。",
          });
        else
          update({
            status: "error",
            dist: selection.dist,
            message: publicationErrorMessage(
              new PublicationRequestError(result.code, result.status, result.reason),
            ),
          });
      } catch {
        if (task.id === operation)
          update({
            status: "uncertain",
            selection,
            message: "公開結果を確認できません。公開情報を確認してください。",
          });
      }
    },
    cancel() {
      if (
        state.status === "publishing" ||
        state.status === "uncertain" ||
        state.status === "resolving"
      )
        return;
      operation++;
      active?.abort();
      active = undefined;
      update({ status: "idle" });
    },
    dispose() {
      operation++;
      active?.abort();
      active = undefined;
      if (state.status === "publishing" || state.status === "resolving") {
        update({
          status: "uncertain",
          selection: state.selection,
          ...(state.status === "resolving" && state.presentationId
            ? { presentationId: state.presentationId }
            : {}),
          message: "公開結果を確認できません。公開情報を確認してください。",
        });
      } else if (state.status !== "uncertain") update({ status: "idle" });
    },
  };
}
