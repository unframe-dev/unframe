import { useMemo, useState, type FormEvent } from "react";
import encodeQR from "qr";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import styles from "./settings-pages.module.css";

type TwoFactorState =
  | { status: "disabled" }
  | { status: "setup"; uri: string; backupCodes: string[] }
  | { status: "enabled"; backupCodes?: string[] };

export function TwoFactorSettings({
  initialEnabled,
  hasPassword,
  googleLinked,
}: {
  initialEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
}) {
  const [state, setState] = useState<TwoFactorState>({
    status: initialEnabled ? "enabled" : "disabled",
  });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const uri = state.status === "setup" ? state.uri : "";
  const registration = useMemo(
    () =>
      uri
        ? {
            qr: encodeQR(uri, "data-url", { border: 4, scale: 6 }),
            secret: new URL(uri).searchParams.get("secret"),
          }
        : null,
    [uri],
  );

  const perform = async (task: () => Promise<void>, failureMessage: string) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  };

  const begin = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const result = await auth.twoFactor.enable({ password });
      if (result.error) throw result.error;
      if (!result.data || !("totpURI" in result.data) || !result.data.totpURI) {
        throw new Error("Missing authenticator registration");
      }
      setState({ status: "setup", uri: result.data.totpURI, backupCodes: result.data.backupCodes });
      setPassword("");
    }, "設定を開始できませんでした。現在のパスワードを確認して、もう一度お試しください。");
  };
  const verify = (event: FormEvent) => {
    event.preventDefault();
    if (state.status !== "setup") return;
    void perform(async () => {
      const result = await auth.twoFactor.verifyTotp({ code });
      if (result.error) throw result.error;
      setState({ status: "enabled", backupCodes: state.backupCodes });
      setCode("");
    }, "コードを確認して、もう一度お試しください。");
  };
  const disable = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const result = await auth.twoFactor.disable({ password });
      if (result.error) throw result.error;
      setState({ status: "disabled" });
      setPassword("");
    }, "無効化できませんでした。現在のパスワードを確認して、もう一度お試しください。");
  };

  return (
    <section className={styles["section"]} aria-labelledby="two-factor-heading">
      <header className={styles["sectionHeading"]}>
        <h2 id="two-factor-heading">二要素認証</h2>
        <p>メールアドレスとパスワードでのログインに、任意で認証アプリのコードを追加します。</p>
      </header>
      <div className={styles["securityEditor"]}>
        {googleLinked ? (
          <>
            <p>Googleログインの二段階認証は、Googleアカウントで設定してください。</p>
            <a
              className="w-fit underline underline-offset-4"
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
            >
              Googleのセキュリティー設定
            </a>
          </>
        ) : null}
        {!hasPassword ? <p>Unframeの二要素認証は、パスワードを設定すると利用できます。</p> : null}
        {hasPassword ? (
          <>
            {state.status === "disabled" || state.status === "enabled" ? (
              <>
                <p role="status">{state.status === "enabled" ? "有効" : "未設定"}</p>
                <form onSubmit={state.status === "enabled" ? disable : begin}>
                  <Label>
                    現在のパスワード
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={busy}
                      required
                    />
                  </Label>
                  <Button
                    type="submit"
                    variant={state.status === "enabled" ? "outline" : "default"}
                    disabled={busy || !password}
                  >
                    {state.status === "enabled" ? "二要素認証を無効化" : "二要素認証を設定"}
                  </Button>
                </form>
              </>
            ) : null}
            {state.status === "setup" && registration ? (
              <form onSubmit={verify}>
                <p>認証アプリで QR コードを読み取り、表示された6桁のコードを入力してください。</p>
                <img
                  className={styles["authenticatorQr"]}
                  src={registration.qr}
                  alt="認証アプリ登録用 QR コード"
                />
                <details>
                  <summary>QR コードを読み取れない場合</summary>
                  <p>認証アプリに次のキーを入力してください。</p>
                  <code className={styles["setupKey"]}>{registration.secret}</code>
                </details>
                <Label>
                  認証コード
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    disabled={busy}
                    required
                  />
                </Label>
                <div className={styles["actions"]}>
                  <Button type="submit" disabled={busy || !/^[0-9]{6}$/.test(code)}>
                    コードを確認
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setState({ status: "disabled" });
                      setCode("");
                      setError("");
                    }}
                  >
                    キャンセル
                  </Button>
                </div>
              </form>
            ) : null}
            {state.status === "enabled" && state.backupCodes?.length ? (
              <div className={styles["backupCodes"]}>
                <h3>バックアップコード</h3>
                <p>
                  認証アプリを使えないときに利用できます。この画面を閉じる前に安全な場所へ保管してください。
                </p>
                <ul>
                  {state.backupCodes.map((backupCode) => (
                    <li key={backupCode}>
                      <code>{backupCode}</code>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" onClick={() => setState({ status: "enabled" })}>
                  保存しました
                </Button>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className={styles["error"]}>
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
