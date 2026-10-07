import { useEffect, useRef, useState } from "react";
import type { EditorApi, PublicationAuth } from "./api";

export type DisplayReceipt = { requestId: string; buildIdentity: string };
export type PublicationApi = Pick<
  EditorApi,
  "publicationAuth" | "beginPublicationAuth" | "cancelPublicationAuth" | "publish"
>;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const verificationUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export function PublicationPanel({
  api,
  receipt,
}: {
  api: PublicationApi;
  receipt: DisplayReceipt | null;
}) {
  const [auth, setAuth] = useState<PublicationAuth | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [publishedRequest, setPublishedRequest] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    ++epoch.current;
    let active = true;
    let reading = false;
    const read = async () => {
      if (reading || !active) return;
      reading = true;
      const serial = epoch.current;
      try {
        const next = await api.publicationAuth();
        if (epoch.current === serial) setAuth(next);
      } catch (error) {
        if (epoch.current === serial) setMessage(`認証状態を確認できません: ${errorText(error)}`);
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      active = false;
      epoch.current++;
      clearInterval(timer);
    };
  }, [api]);
  async function authenticate() {
    const serial = ++epoch.current;
    setPending(true);
    setMessage("");
    try {
      const next = await api.beginPublicationAuth();
      if (epoch.current === serial) setAuth(next);
    } catch (error) {
      setMessage(`認証開始失敗: ${errorText(error)}`);
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    const serial = ++epoch.current;
    setPending(true);
    try {
      await api.cancelPublicationAuth();
      const next = await api.publicationAuth();
      if (epoch.current === serial) setAuth(next);
    } catch (error) {
      setMessage(`認証取消失敗: ${errorText(error)}`);
    } finally {
      setPending(false);
    }
  }
  async function publish() {
    if (!receipt || auth?.status !== "authenticated") return;
    const request = receipt;
    setPending(true);
    setMessage("");
    try {
      const result = await api.publish(request.requestId);
      if (result.buildId !== request.buildIdentity)
        throw new Error("公開結果の build identity が一致しません。");
      setPublishedRequest(request.requestId);
      setMessage(`公開完了: ${result.buildId}（epoch ${result.publicationEpoch}）`);
    } catch (error) {
      setMessage(`公開失敗: ${errorText(error)}`);
    } finally {
      setPending(false);
    }
  }
  const url = verificationUrl(auth?.verificationUrl);
  return (
    <section aria-label="公開" className="editor-publication">
      <h2>公開</h2>
      {!receipt && <p>Dist Preview を正常に表示してから公開できます。</p>}
      {auth?.status === "unconfigured" && <p>Local Host の公開先が設定されていません。</p>}
      {auth?.status === "pending" && (
        <div>
          <p>確認コード: {auth.userCode}</p>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              認証ページを開く
            </a>
          )}
          <button disabled={pending} onClick={() => void cancel()}>
            認証を取り消す
          </button>
        </div>
      )}
      {auth?.status === "expired" && (
        <p>認証の有効期限が切れました。認証を開始し直してください。</p>
      )}
      {auth?.status === "denied" && <p>認証が拒否されました。</p>}
      <button
        disabled={
          !receipt ||
          !auth ||
          pending ||
          auth.status === "pending" ||
          auth.status === "unconfigured" ||
          publishedRequest === receipt.requestId
        }
        onClick={() => void (auth?.status === "authenticated" ? publish() : authenticate())}
      >
        {pending
          ? "処理中…"
          : auth?.status === "authenticated"
            ? "表示した Dist を公開"
            : "公開の認証を開始"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
