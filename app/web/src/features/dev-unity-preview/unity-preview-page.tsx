import { useCallback, useEffect, useRef, useState } from "react";
import {
  advancePreview,
  createPreviewState,
  dispatchPreviewAction,
  loadPreviewDist,
  previewActions,
  previewFrame,
  type PreviewDocument,
  type PreviewState,
} from "./model";
import styles from "./unity-preview-page.module.css";

const previewUrl = "/unity-preview/index.html";
type BuildStatus = "checking" | "missing" | "failed" | "ready";
type View = "front" | "upper-left" | "right";
const views: { id: View; label: string }[] = [
  { id: "front", label: "正面" },
  { id: "upper-left", label: "左斜め上" },
  { id: "right", label: "右斜め" },
];

export function UnityPreviewPage() {
  const [build, setBuild] = useState<BuildStatus>("checking");
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [state, setState] = useState<PreviewState | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>("front");
  const [error, setError] = useState("");
  const iframe = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  const loadRequest = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback((method: string, payload: unknown) => {
    iframe.current?.contentWindow?.postMessage(
      {
        source: "unframe-preview-host",
        method,
        payload: typeof payload === "string" ? payload : JSON.stringify(payload),
      },
      window.location.origin,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(previewUrl, { cache: "no-store", signal: controller.signal });
        if (response.status === 404) {
          setBuild("missing");
          return;
        }
        if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
          setBuild("failed");
          return;
        }
        const html = await response.text();
        if (!controller.signal.aborted)
          setBuild(html.includes("createUnityInstance(") ? "ready" : "missing");
      } catch {
        if (!controller.signal.aborted) setBuild("failed");
      }
    })();
    return () => {
      controller.abort();
      loadRequest.current++;
    };
  }, []);

  useEffect(() => () => document?.dispose(), [document]);

  useEffect(() => {
    function receive(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow)
        return;
      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        !("source" in message) ||
        message.source !== "unframe-unity-preview" ||
        !("type" in message)
      )
        return;
      if (message.type === "ready") setReady(true);
      if (
        message.type === "loaded" &&
        "generation" in message &&
        message.generation === generation.current
      ) {
        setLoaded(true);
      }
      if (
        message.type === "error" &&
        (!("generation" in message) || message.generation === generation.current)
      ) {
        setError("プレビューの描画に失敗しました。dist を開き直してください。");
        setLoaded(false);
        setPlaying(false);
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (!ready || !document) return;
    setLoaded(false);
    send("LoadScene", { ...document.scene, generation: generation.current });
  }, [ready, document, send]);

  useEffect(() => {
    if (ready) send("SetView", view);
  }, [ready, loaded, view, send]);
  useEffect(() => {
    if (loaded && document && state)
      send("ApplyFrame", previewFrame(document, state, generation.current));
  }, [loaded, document, state, send]);

  useEffect(() => {
    if (!playing || !loaded || !document || !stateRef.current) return;
    let startedAt: number | undefined;
    const initialTime = stateRef.current.runtimeTimeMilliseconds;
    let handle: number;
    function tick(now: number) {
      if (!document || !stateRef.current) return;
      try {
        startedAt ??= now;
        const next = advancePreview(
          document,
          stateRef.current,
          initialTime + Math.floor(now - startedAt),
        );
        stateRef.current = next;
        setState(next);
        if (next.ended) {
          setPlaying(false);
          return;
        }
        handle = requestAnimationFrame(tick);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "再生に失敗しました。");
        setPlaying(false);
      }
    }
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, loaded, document]);

  async function openFiles(files: readonly File[]) {
    if (!files.length) return;
    const request = ++loadRequest.current;
    generation.current++;
    setPlaying(false);
    setLoaded(false);
    setLoading(true);
    setError("");
    setDocument(null);
    setState(null);
    send("ClearScene", "");
    try {
      const next = await loadPreviewDist(files);
      if (request !== loadRequest.current) {
        next.dispose();
        return;
      }
      const initial = createPreviewState(next);
      stateRef.current = initial;
      setState(initial);
      setDocument(next);
      setView("front");
    } catch (cause) {
      if (request === loadRequest.current)
        setError(cause instanceof Error ? cause.message : "dist を読み込めませんでした。");
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }

  const actions = document && state ? previewActions(document, state) : [];
  const enabled = loaded && !!document && !!state;
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["header"]}>
        <div>
          <p className={styles["brand"]}>Unframe</p>
          <h1>Preview editor</h1>
        </div>
        <label className={styles["open"]}>
          dist フォルダーを開く
          <input
            aria-label="dist フォルダーを開く"
            type="file"
            multiple
            ref={(input) => {
              input?.setAttribute("webkitdirectory", "");
            }}
            onChange={(event) => {
              void openFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </label>
      </header>
      <div className={styles["toolbar"]}>
        <div role="group" aria-label="視点">
          {views.map((item) => (
            <button
              key={item.id}
              disabled={!enabled}
              aria-pressed={view === item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="再生操作">
          <button disabled={!enabled || state?.ended} onClick={() => setPlaying((value) => !value)}>
            {playing ? "一時停止" : "再生"}
          </button>
          <button
            disabled={!enabled}
            onClick={() => {
              if (!document) return;
              setPlaying(false);
              const initial = createPreviewState(document);
              stateRef.current = initial;
              setState(initial);
            }}
          >
            最初に戻す
          </button>
          <output aria-label="再生時間">
            {((state?.runtimeTimeMilliseconds ?? 0) / 1000).toFixed(2)} s
          </output>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles["error"]}>
          {error}
        </p>
      )}
      <div className={styles["workspace"]}>
        <section className={styles["viewport"]} aria-label="プレゼンテーション表示">
          {build === "ready" && (
            <iframe
              ref={iframe}
              title="Unity プレビュー"
              src={previewUrl}
              className={styles["frame"]}
              onError={() => setBuild("failed")}
            />
          )}
          {(build !== "ready" || !loaded) && (
            <div className={styles["overlay"]} role={build === "failed" ? "alert" : "status"}>
              {build === "checking"
                ? "Unity ビルドを確認中…"
                : build === "missing"
                  ? "Unity ビルドがありません。nix run .#unity-web-preview を実行してください。"
                  : build === "failed"
                    ? "Unity ビルドを読み込めませんでした。開発サーバーを確認してください。"
                    : loading
                      ? "dist を検証中…"
                      : document
                        ? "プレビューを準備中…"
                        : "dist フォルダーを開いてプレビューを開始"}
            </div>
          )}
        </section>
        <aside className={styles["sidebar"]}>
          <h2>{document?.artifacts.definition.metadata.title || "プレゼンテーション"}</h2>
          {!document && (
            <p>
              フレームワークでビルドした dist
              を選択してください。ファイルはブラウザー内で読み込みます。
            </p>
          )}
          {state && (
            <dl>
              <dt>Group</dt>
              <dd>{state.currentGroupId}</dd>
              <dt>Step</dt>
              <dd>{state.currentStepId}</dd>
              <dt>状態</dt>
              <dd>{state.ended ? "終了" : playing ? "再生中" : "一時停止"}</dd>
            </dl>
          )}
          <h2>プレゼン操作</h2>
          <p>現在の画面に定義された操作を実行できます。アニメーションは「再生」で進みます。</p>
          <div className={styles["actions"]}>
            {actions.map((action) => (
              <button
                key={action.id}
                disabled={!enabled || state?.ended}
                onClick={() => {
                  if (!document || !state) return;
                  try {
                    const next = dispatchPreviewAction(document, state, action.input);
                    stateRef.current = next;
                    setState(next);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "操作に失敗しました。");
                  }
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
          {document && !actions.length && <p>この Step で実行できる操作はありません。</p>}
        </aside>
      </div>
      <footer className={styles["footer"]}>
        <span>Unity preview · ローカルファイル</span>
        <span>視点を変えても再生状態は維持されます</span>
      </footer>
    </main>
  );
}
