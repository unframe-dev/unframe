import { GoogleLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { BrandLink } from "@/shared/brand/brand-link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import moduleStyles from "@/shared/layouts/public-pages.module.css";
const styles = {
  main: moduleStyles["main"]!,
  header: moduleStyles["header"]!,
  deviceShell: moduleStyles["deviceShell"]!,
  deviceIntro: moduleStyles["deviceIntro"]!,
  deviceLede: moduleStyles["deviceLede"]!,
  deviceActions: moduleStyles["deviceActions"]!,
};

type PageState = "entry" | "pending" | "approved" | "denied";

function errorMessage(error?: { code?: string | undefined; error?: string | undefined } | null) {
  switch (error?.error ?? error?.code) {
    case "expired_token":
      return "このコードの有効期限が切れています。";
    case "device_code_already_processed":
      return "このコードはすでに処理されています。";
    case "invalid_request":
      return "コードが正しくないか、すでに利用できません。";
    case "access_denied":
      return "このコードを処理する権限がありません。";
    case "unauthorized":
      return "この操作にはログインが必要です。";
    default:
      return "処理中に問題が発生しました。時間をおいてもう一度お試しください。";
  }
}

function deviceCallbackUrl(userCode: string) {
  const url = new URL("/device", window.location.origin);
  if (userCode) url.searchParams.set("user_code", userCode);
  return url.toString();
}

export function DeviceAuthorizationPage({ initialUserCode }: { initialUserCode: string }) {
  const [userCode, setUserCode] = useState(initialUserCode);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionFailure, setSessionFailure] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [state, setState] = useState<PageState>("entry");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void auth
      .getSession()
      .then((result) => {
        if (!active) return;
        setSignedIn(Boolean(result.data));
        setSessionFailure(false);
        setSessionReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSignedIn(false);
        setSessionFailure(true);
        setMessage(errorMessage());
        setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, [sessionAttempt]);

  const retrySession = () => {
    setMessage(undefined);
    setSessionFailure(false);
    setSessionReady(false);
    setSessionAttempt((attempt) => attempt + 1);
  };

  const verify = async () => {
    const code = userCode.trim();
    if (!code) {
      setMessage("ユーザーコードを入力してください。");
      return;
    }
    if (!signedIn) {
      setMessage("コードを確認するにはログインしてください。");
      return;
    }

    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.verifyDeviceAuthorization(code);
      if (result.error) {
        setMessage(errorMessage(result.error));
        return;
      }
      setState(result.data.status);
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: "approve" | "deny") => {
    if (loading) return;
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.device[decision]({ userCode: userCode.trim() });
      if (result.error) {
        setMessage(errorMessage(result.error));
        return;
      }
      setState(decision === "approve" ? "approved" : "denied");
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: deviceCallbackUrl(userCode.trim()),
      });
      if (result.error) setMessage(errorMessage(result.error));
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const terminalMessage =
    state === "approved"
      ? "デバイスの接続を承認しました。"
      : state === "denied"
        ? "デバイスの接続を拒否しました。"
        : undefined;

  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <BrandLink />
        <a href="https://un-fra.me/docs/">Docs</a>
      </header>
      <section className={styles.deviceShell}>
        <header className={styles.deviceIntro}>
          <h1>Connect a device.</h1>
          <p className={styles.deviceLede}>
            デバイスに表示されたユーザーコードを確認し、接続を承認または拒否します。
          </p>
        </header>
        <div className={styles.deviceActions}>
          {message ? (
            <p role="alert" className="rounded-md border border-[var(--destructive)] p-3 text-sm">
              {message}
            </p>
          ) : null}
          {terminalMessage ? (
            <p
              role="alert"
              className="rounded-md border border-emerald-700 p-3 text-sm text-emerald-800"
            >
              {terminalMessage}
            </p>
          ) : null}

          {!sessionReady ? (
            <p className="text-sm text-[var(--muted)]">ログイン状態を確認しています…</p>
          ) : !signedIn ? (
            <div className="grid gap-3">
              <p className="rounded-md border p-3 text-sm">
                コードを確認するには Google でログインしてください。
              </p>
              {sessionFailure ? (
                <Button variant="ghost" disabled={loading} onClick={retrySession}>
                  ログイン状態を再確認
                </Button>
              ) : null}
              <Button disabled={loading} onClick={() => void signIn()}>
                <GoogleLogoIcon /> Google でログイン
              </Button>
            </div>
          ) : (
            <>
              <Label className="grid gap-2 text-sm font-medium">
                ユーザーコード
                <Input
                  value={userCode}
                  disabled={loading || state !== "entry"}
                  onChange={(event) => setUserCode(event.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH"
                  autoComplete="one-time-code"
                  aria-label="ユーザーコード"
                  className="h-10 rounded-md border bg-white px-3 font-normal outline-none focus:border-[var(--primary)]"
                />
              </Label>

              {state === "entry" ? (
                <Button disabled={loading} onClick={() => void verify()}>
                  コードを確認
                </Button>
              ) : null}

              {state === "pending" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button disabled={loading} onClick={() => void decide("approve")}>
                    承認する
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={loading}
                    onClick={() => void decide("deny")}
                  >
                    拒否する
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
