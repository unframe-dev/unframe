import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { AuthLayout } from "./auth-layout";
import { credentialsSchema, type Credentials } from "./auth-validation";
import { FormErrors } from "./form-errors";
import { GoogleSignIn } from "./google-sign-in";
import { VerificationResend } from "./verification-resend";
import styles from "@/shared/layouts/public-pages.module.css";

function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function LoginPage({
  verified = false,
  error = "",
}: {
  verified?: boolean;
  error?: string;
} = {}) {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [mfa, setMfa] = useState(false);
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
  });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    setUnverifiedEmail("");
    try {
      const result = await auth.signIn.email({
        ...values,
        callbackURL: new URL("/home", window.location.origin).href,
      });
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        setMfa(true);
        return;
      }
      if (result.error) {
        if (hasErrorCode(result.error, "EMAIL_NOT_VERIFIED")) setUnverifiedEmail(values.email);
        setMessage(
          hasErrorCode(result.error, "EMAIL_NOT_VERIFIED")
            ? "メールアドレスを確認してください。"
            : "ログインできませんでした。入力内容を確認してください。",
        );
        return;
      }
      await navigate({ to: "/home" });
    } catch {
      setMessage("ログインできませんでした。もう一度お試しください。");
    }
  });
  return (
    <AuthLayout title="Login.">
      {error ? (
        <p role="alert" className={styles["error"]}>
          {error === "oauth"
            ? "Google 認証を完了できませんでした。もう一度お試しください。"
            : "メールの確認リンクが無効か、有効期限が切れています。ログインして確認メールを再送してください。"}
        </p>
      ) : verified ? (
        <p role="status">メールアドレスを確認しました。</p>
      ) : null}
      {mfa ? (
        <MfaForm onDone={() => void navigate({ to: "/home" })} />
      ) : (
        <>
          <form onSubmit={submit}>
            <FormErrors errors={form.formState.errors} />
            <Label>
              メールアドレス
              <Input
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                aria-describedby={form.formState.errors.email ? "email-error" : undefined}
                {...form.register("email")}
              />
            </Label>
            <Label>
              パスワード
              <Input
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                {...form.register("password")}
              />
            </Label>
            {message ? (
              <p role="alert" className={styles["error"]}>
                {message}
              </p>
            ) : null}
            {unverifiedEmail ? (
              <VerificationResend key={unverifiedEmail} email={unverifiedEmail} />
            ) : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "ログイン中…" : "ログイン"}
            </Button>
          </form>
          <div className={styles["divider"]} aria-hidden="true">
            or
          </div>
          <GoogleSignIn label="Google でログイン" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/recover">パスワードを忘れた場合</Link>
            <Link to="/signup">アカウントを作成</Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
function MfaForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    const result =
      method === "totp"
        ? await auth.twoFactor.verifyTotp({ code, trustDevice: false })
        : await auth.twoFactor.verifyBackupCode({ code, trustDevice: false });
    setLoading(false);
    if (result.error) setMessage("コードを確認してください。");
    else onDone();
  };
  return (
    <form onSubmit={submit}>
      <p>二要素認証が必要です。認証アプリのコード、またはバックアップコードを入力してください。</p>
      <Label>
        確認方法
        <Select
          value={method}
          onChange={(event) => setMethod(event.target.value as "totp" | "backup")}
        >
          <option value="totp">認証アプリ</option>
          <option value="backup">バックアップコード</option>
        </Select>
      </Label>
      <Label>
        {method === "totp" ? "認証コード" : "バックアップコード"}
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          required
        />
      </Label>
      {message ? (
        <p role="alert" className={styles["error"]}>
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "確認中…" : "確認"}
      </Button>
    </form>
  );
}
