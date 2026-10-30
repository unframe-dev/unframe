import { zodResolver } from "@hookform/resolvers/zod";
import { GoogleLogoIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { controlPlaneAuth } from "@/features/auth/control-plane-auth";
import { BrandLink } from "@/shared/brand/brand-link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import moduleStyles from "@/shared/layouts/public-pages.module.css";
const styles = {
  main: moduleStyles["main"]!,
  header: moduleStyles["header"]!,
  panel: moduleStyles["panel"]!,
  copy: moduleStyles["copy"]!,
  lede: moduleStyles["lede"]!,
  form: moduleStyles["form"]!,
  error: moduleStyles["error"]!,
  divider: moduleStyles["divider"]!,
};

const credentialsSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください。"),
  password: z.string().min(8, "パスワードは8文字以上にしてください。"),
});
type Credentials = z.infer<typeof credentialsSchema>;
const auth = controlPlaneAuth;
function verificationCallbackUrl() {
  return new URL("/login?verified=true", window.location.origin).href;
}

function GoogleSignIn({ label }: { label: string }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const signIn = async () => {
    setMessage("");
    setLoading(true);
    try {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: new URL("/home", window.location.origin).href,
        errorCallbackURL: new URL("/login?provider=google", window.location.origin).href,
      });
      if (result.error) setMessage("Google 認証を開始できませんでした。もう一度お試しください。");
    } catch {
      setMessage("Google 認証を開始できませんでした。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Button type="button" disabled={loading} onClick={() => void signIn()}>
        <GoogleLogoIcon aria-hidden="true" />
        {loading ? "Google に接続中…" : label}
      </Button>
      {message ? (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      ) : null}
    </>
  );
}

function VerificationResend({ email }: { email: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const resend = async () => {
    setStatus("sending");
    try {
      const result = await auth.sendVerificationEmail({
        email,
        callbackURL: verificationCallbackUrl(),
      });
      setStatus(result.error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  };
  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={status === "sending"}
        onClick={() => void resend()}
      >
        {status === "sending" ? "送信中…" : "確認メールを再送"}
      </Button>
      {status === "sent" ? <p role="status">確認メールを再送しました。</p> : null}
      {status === "error" ? (
        <p role="alert" className={styles.error}>
          確認メールを再送できませんでした。もう一度お試しください。
        </p>
      ) : null}
    </div>
  );
}
function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <BrandLink />
        <a href="https://un-fra.me/docs/">Docs</a>
      </header>
      <section className={styles.panel}>
        <header className={styles.copy}>
          <h1>{title}</h1>
          <p className={styles.lede}>{description}</p>
        </header>
        <div className={styles.form}>{children}</div>
      </section>
    </main>
  );
}
function FormErrors({ errors }: { errors: Record<string, { message?: string } | undefined> }) {
  const messages = Object.entries(errors).flatMap(([field, error]) =>
    error?.message ? [{ field, message: error.message }] : [],
  );
  return messages.length ? (
    <div role="alert" className={styles.error}>
      <p>入力内容を確認してください。</p>
      <ul>
        {messages.map(({ field, message }) => (
          <li id={`${field}-error`} key={field}>
            {message}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
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
    <AuthLayout title="Sign in." description="Unframe にログインします。">
      {error ? (
        <p role="alert" className={styles.error}>
          {error === "oauth"
            ? "Google 認証を完了できませんでした。もう一度お試しください。"
            : "メールの確認リンクが無効か、有効期限が切れています。ログインして確認メールを再送してください。"}
        </p>
      ) : verified ? (
        <p role="status">メールアドレスを確認しました。ログインして Unframe を始めましょう。</p>
      ) : null}
      {mfa ? (
        <MfaForm onDone={() => void navigate({ to: "/home" })} />
      ) : (
        <>
          <GoogleSignIn label="Google でログイン" />
          <p className={styles.divider}>または</p>
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
              <p role="alert" className={styles.error}>
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
          <p>
            <Link to="/recover">パスワードを忘れた場合</Link> ·{" "}
            <Link to="/signup">アカウントを作成</Link>
          </p>
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
        <p role="alert" className={styles.error}>
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "確認中…" : "確認"}
      </Button>
    </form>
  );
}
export function SignupPage() {
  const [message, setMessage] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const form = useForm<Credentials & { name: string }>({
    resolver: zodResolver(
      credentialsSchema.extend({
        name: z.string().trim().min(1, "名前を入力してください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    try {
      const result = await auth.signUp.email({ ...values, callbackURL: verificationCallbackUrl() });
      if (result.error)
        setMessage("登録できませんでした。入力内容を確認して、もう一度お試しください。");
      else setRegisteredEmail(values.email);
    } catch {
      setMessage("登録できませんでした。もう一度お試しください。");
    }
  });
  return (
    <AuthLayout title="Create an account." description="新しいアカウントを作成します。">
      {registeredEmail ? (
        <>
          <p role="status">
            {registeredEmail}{" "}
            に確認メールを送信しました。メール内のリンクで確認してからログインしてください。
          </p>
          <p>メールが届かない場合は迷惑メールフォルダーも確認してください。</p>
          <VerificationResend email={registeredEmail} />
          <Button type="button" variant="outline" onClick={() => setRegisteredEmail("")}>
            メールアドレスを変更
          </Button>
        </>
      ) : (
        <>
          <GoogleSignIn label="Google で登録" />
          <p className={styles.divider}>または</p>
          <form onSubmit={submit}>
            <FormErrors errors={form.formState.errors} />
            <Label>
              名前
              <Input
                autoComplete="name"
                aria-invalid={Boolean(form.formState.errors.name)}
                aria-describedby={form.formState.errors.name ? "name-error" : undefined}
                {...form.register("name")}
              />
            </Label>
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
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                {...form.register("password")}
              />
            </Label>
            {message ? (
              <p role="alert" className={styles.error}>
                {message}
              </p>
            ) : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "登録中…" : "登録"}
            </Button>
          </form>
        </>
      )}
      <p>
        <Link to="/login">ログインへ</Link>
      </p>
    </AuthLayout>
  );
}
export function RecoverPage() {
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const form = useForm<{ email: string }>({
    resolver: zodResolver(
      z.object({
        email: z.string().email("有効なメールアドレスを入力してください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async ({ email }) => {
    setDone(false);
    setMessage("");
    const result = await auth.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/recover/reset`,
    });
    if (result.error) setMessage("再設定メールを送信できませんでした。");
    else setDone(true);
  });
  return (
    <AuthLayout title="Reset your password." description="再設定用のメールを送信します。">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <Label>
          メールアドレス
          <Input
            autoComplete="email"
            aria-invalid={Boolean(form.formState.errors.email)}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
        </Label>
        {done ? <p role="status">再設定メールを送信しました。メールをご確認ください。</p> : null}
        {message ? (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "送信中…" : "再設定メールを送信"}
        </Button>
      </form>
    </AuthLayout>
  );
}
export function ResetPage({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const form = useForm<{ password: string }>({
    resolver: zodResolver(
      z.object({
        password: z.string().min(8, "パスワードは8文字以上にしてください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async ({ password }) => {
    const result = await auth.resetPassword({ newPassword: password, token });
    setMessage(
      result.error
        ? "再設定できませんでした。リンクを確認してください。"
        : "パスワードを再設定しました。ログインしてください。",
    );
  });
  return (
    <AuthLayout title="Choose a password." description="新しいパスワードを設定します。">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <Label>
          新しいパスワード
          <Input
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
        </Label>
        {message ? <p role="status">{message}</p> : null}
        <Button type="submit" disabled={!token || form.formState.isSubmitting}>
          パスワードを再設定
        </Button>
      </form>
    </AuthLayout>
  );
}
