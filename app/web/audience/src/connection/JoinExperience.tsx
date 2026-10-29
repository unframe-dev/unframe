import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { JoinController, JoinSnapshot } from "./join-controller";
import "./connection.css";

const unavailableSnapshot: JoinSnapshot = { phase: "idle" };
const unavailableSubscribe = () => () => {};
const unavailableGetSnapshot = () => unavailableSnapshot;

const progressText: Record<JoinSnapshot["phase"], string> = {
  idle: "ルームコードを入力してください。",
  joining: "ルームに参加中…",
  delivery: "表示データを取得中…",
  bootstrap: "接続情報を取得中…",
  prepared: "接続準備完了。カメラを開始してください。",
  error: "接続準備を完了できませんでした。",
  ended: "このルームの配信は終了しています。",
};

const errorText: Record<string, string> = {
  "invalid-config": "現在ルームに接続できません。会場スタッフにご確認ください。",
  "invalid-join-code": "ルームコードを XXXXXXXX の8文字で入力してください。",
  "invalid-session-id": "セッション情報が正しくありません。もう一度参加してください。",
  aborted: "接続準備をキャンセルしました。",
  "network-error": "サーバーに接続できません。通信環境を確認し、もう一度お試しください。",
  "http-error": "サーバーが要求を受け付けませんでした。",
  unauthorized: "参加資格を確認できません。もう一度お試しください。",
  forbidden: "このルームを視聴する権限がありません。",
  "not-found": "ルームが見つかりません。コードを確認してください。",
  conflict: "ルームの状態が変わりました。もう一度参加してください。",
  "connection-unavailable": "この接続は利用できません。もう一度ルームへ参加してください。",
  "rate-limited": "参加の試行が多すぎます。時間を置いて再試行してください。",
  "server-error": "サーバーで問題が発生しました。時間を置いて再試行してください。",
  "invalid-response": "サーバーの応答を確認できません。",
  "expired-bootstrap": "取得した接続情報の有効期限が切れています。再試行してください。",
  "expired-connection": "接続準備の有効期限が切れました。もう一度参加してください。",
  "session-ended": "このルームの配信は終了しています。",
  "delivery-mismatch": "表示データと接続情報が一致しません。もう一度参加してください。",
};

export function JoinExperience({ controller }: { controller: JoinController | null }) {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? unavailableSubscribe,
    controller?.getSnapshot ?? unavailableGetSnapshot,
  );
  const [code, setCode] = useState("");
  const busy = ["joining", "delivery", "bootstrap"].includes(snapshot.phase);
  const prepared = snapshot.phase === "prepared";
  const validCode = /^[A-HJ-NP-Z2-9]{8}$/.test(code);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (controller && validCode && !busy && !prepared)
      void controller.join(`${code.slice(0, 4)}-${code.slice(4)}`);
  };

  return (
    <main className="audience-join">
      <header className="audience-join__header">
        <a className="audience-join__brand" href="/" aria-label="unframe Audience ホーム">
          unframe <span>AUDIENCE</span>
        </a>
        <span className="audience-join__step">01 / 入室</span>
      </header>
      <section className="audience-join__card" aria-labelledby="audience-join-title">
        <div className="audience-join__symbol" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <rect x="5" y="7" width="22" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
            <path
              d="M12 13h8M12 19h5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <p className="audience-join__eyebrow">会場のプレゼンテーションへ</p>
        <h1 id="audience-join-title">
          {snapshot.phase === "ended" ? "配信は終了しました" : "ルームに参加"}
        </h1>
        <p className="audience-join__intro">会場で案内されたルームコードを入力してください。</p>
        {!controller && (
          <p className="audience-join__notice">
            現在、このサイトからルームへ参加する準備が整っていません。会場スタッフにご確認ください。
          </p>
        )}
        <form onSubmit={submit} aria-labelledby="audience-join-title" aria-busy={busy}>
          <label htmlFor="audience-room-code">ルームコード</label>
          <input
            id="audience-room-code"
            name="roomCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replaceAll("-", ""))}
            placeholder="XXXXXXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            pattern="[A-HJ-NP-Z2-9]{8}"
            disabled={!controller || busy || prepared}
            aria-describedby="audience-join-status"
          />
          <p
            id="audience-join-status"
            className="audience-join__status"
            role="status"
            aria-live="polite"
          >
            {busy && <span className="audience-join__spinner" aria-hidden="true" />}
            {progressText[snapshot.phase]}
          </p>
          {snapshot.phase === "error" && (
            <p className="audience-join__notice" role="alert">
              {errorText[snapshot.error ?? ""] ??
                "接続準備中に問題が発生しました。再試行してください。"}
            </p>
          )}
          <div className="audience-join__actions">
            {busy ? (
              <button type="button" onClick={() => controller?.cancel()}>
                キャンセル
              </button>
            ) : prepared ? (
              <>
                <button type="button" onClick={() => void controller?.refresh()}>
                  取得情報を更新
                </button>
                <button
                  className="audience-join__secondary"
                  type="button"
                  onClick={() => controller?.leave()}
                >
                  退出
                </button>
              </>
            ) : (
              <button type="submit" disabled={!controller || !validCode}>
                {snapshot.phase === "error" ? "再試行" : "参加する"}
              </button>
            )}
          </div>
        </form>
        <p className="audience-join__privacy">ログインせずに視聴できます</p>
      </section>
      <footer className="audience-join__footer">会場の体験を、あなたの画面に。</footer>
    </main>
  );
}
