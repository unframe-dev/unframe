import { useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { Brand } from "../ui/Brand";
import type { JoinController, JoinSnapshot } from "./join-controller";
import "./connection.css";

const unavailableStore = createStore<JoinSnapshot>(() => ({ phase: "idle" }));

const progressText: Record<JoinSnapshot["phase"], string> = {
  idle: "ルームコードを入力してください。",
  joining: "ルームに参加中…",
  delivery: "表示データを取得中…",
  bootstrap: "接続情報を取得中…",
  recovering: "配信の接続復旧を待っています…",
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
  const snapshot = useStore(controller?.store ?? unavailableStore, (state) => state);
  const [code, setCode] = useState("");
  const busy = ["joining", "delivery", "bootstrap", "recovering"].includes(snapshot.phase);
  const prepared = snapshot.phase === "prepared";
  const validCode = /^[A-HJ-NP-Z2-9]{8}$/.test(code);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (controller && validCode && !busy && !prepared)
      void controller.join(`${code.slice(0, 4)}-${code.slice(4)}`);
  };

  return (
    <main className="audience-join flex min-h-dvh flex-col items-center gap-10 px-5 py-6 sm:px-8">
      <header className="flex w-full max-w-6xl items-center justify-between">
        <Brand />
      </header>
      <section
        className="audience-join__content my-auto w-full max-w-md"
        aria-labelledby="audience-join-title"
      >
        <h1 id="audience-join-title">
          {snapshot.phase === "ended" ? "配信は終了しました" : "ルームに参加"}
        </h1>
        {snapshot.phase === "ended" ? (
          <div className="grid gap-6">
            <p className="audience-join__intro">ご視聴ありがとうございました。</p>
            <Button variant="contained" onClick={() => controller?.leave()}>
              別のルームに参加
            </Button>
          </div>
        ) : (
          <>
            <p className="audience-join__intro">会場で案内されたルームコードを入力してください。</p>
            {!controller && (
              <p className="audience-join__notice">
                現在、このサイトからルームへ参加する準備が整っていません。会場スタッフにご確認ください。
              </p>
            )}
            <form onSubmit={submit} aria-labelledby="audience-join-title" aria-busy={busy}>
              <TextField
                fullWidth
                id="audience-room-code"
                name="roomCode"
                label="ルームコード"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().replaceAll("-", ""))}
                placeholder="XXXXXXXX"
                autoComplete="off"
                disabled={!controller || busy || prepared}
                slotProps={{
                  htmlInput: {
                    autoCapitalize: "characters",
                    spellCheck: false,
                    maxLength: 9,
                    pattern: "[A-HJ-NP-Z2-9]{8}",
                    "aria-describedby": "audience-join-status",
                  },
                }}
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
              <div className="grid gap-3">
                {busy ? (
                  <Button variant="outlined" type="button" onClick={() => controller?.cancel()}>
                    キャンセル
                  </Button>
                ) : prepared ? (
                  <>
                    <Button
                      variant="contained"
                      type="button"
                      onClick={() => void controller?.refresh()}
                    >
                      取得情報を更新
                    </Button>
                    <Button type="button" onClick={() => controller?.leave()}>
                      退出
                    </Button>
                  </>
                ) : (
                  <Button variant="contained" type="submit" disabled={!controller || !validCode}>
                    {snapshot.phase === "error" ? "再試行" : "参加する"}
                  </Button>
                )}
              </div>
            </form>
            <p className="audience-join__privacy">ログインせずに視聴できます</p>
          </>
        )}
      </section>
    </main>
  );
}
