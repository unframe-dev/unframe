import { zodResolver } from "@hookform/resolvers/zod";
import { GoogleLogoIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { controlPlaneAuth } from "../../app/auth/control-plane-auth";
import { BrandLink } from "../../app/brand/brand-link";
import { Button } from "../../components/ui/button";

const credentialsSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください。"),
  password: z.string().min(8, "パスワードは8文字以上にしてください。"),
});
type Credentials = z.infer<typeof credentialsSchema>;
const auth = controlPlaneAuth;
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
    <main id="main-content" className="auth-main">
      <header className="public-header">
        <BrandLink />
        <a href="https://un-fra.me/docs/">Docs</a>
      </header>
      <section className="auth-panel">
        <header className="auth-copy">
          <h1>{title}</h1>
          <p className="auth-lede">{description}</p>
        </header>
        <div className="auth-form">{children}</div>
      </section>
    </main>
  );
}
function FormErrors({ errors }: { errors: Record<string, { message?: string } | undefined> }) {
  const messages = Object.entries(errors).flatMap(([field, error]) =>
    error?.message ? [{ field, message: error.message }] : [],
  );
  return messages.length ? (
    <div role="alert" className="status-error">
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
export function LoginPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [mfa, setMfa] = useState(false);
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
  });
  const submit = form.handleSubmit(async (values) => {
    setMessage("");
    const result = await auth.signIn.email({ ...values, callbackURL: "/home" });
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
      setMfa(true);
      return;
    }
    if (result.error) {
      setMessage("ログインできませんでした。入力内容を確認してください。");
      return;
    }
    await navigate({ to: "/home" });
  });
  const google = async () => {
    setMessage("");
    const result = await auth.signIn.social({
      provider: "google",
      callbackURL: "/home",
    });
    if (result.error) setMessage("Google ログインを開始できませんでした。");
  };
  return (
    <AuthLayout title="Sign in." description="Unframe にログインします。">
      {mfa ? (
        <MfaForm onDone={() => void navigate({ to: "/home" })} />
      ) : (
        <>
          <Button type="button" onClick={() => void google()}>
            <GoogleLogoIcon aria-hidden="true" />
            Google でログイン
          </Button>
          <p className="divider">または</p>
          <form onSubmit={submit}>
            <FormErrors errors={form.formState.errors} />
            <label>
              メールアドレス
              <input
                autoComplete="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                aria-describedby={form.formState.errors.email ? "email-error" : undefined}
                {...form.register("email")}
              />
            </label>
            <label>
              パスワード
              <input
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                {...form.register("password")}
              />
            </label>
            {message ? (
              <p role="alert" className="status-error">
                {message}
              </p>
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
      <label>
        確認方法
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value as "totp" | "backup")}
        >
          <option value="totp">認証アプリ</option>
          <option value="backup">バックアップコード</option>
        </select>
      </label>
      <label>
        {method === "totp" ? "認証コード" : "バックアップコード"}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          required
        />
      </label>
      {message ? (
        <p role="alert" className="status-error">
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
  const form = useForm<Credentials & { name: string }>({
    resolver: zodResolver(
      credentialsSchema.extend({
        name: z.string().min(1, "名前を入力してください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async (values) => {
    const result = await auth.signUp.email({ ...values, callbackURL: "/home" });
    setMessage(
      result.error
        ? "登録できませんでした。"
        : "確認メールを送信しました。メールを確認してからログインしてください。",
    );
  });
  return (
    <AuthLayout title="Create an account." description="新しいアカウントを作成します。">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <label>
          名前
          <input
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={form.formState.errors.name ? "name-error" : undefined}
            {...form.register("name")}
          />
        </label>
        <label>
          メールアドレス
          <input
            autoComplete="email"
            aria-invalid={Boolean(form.formState.errors.email)}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
        </label>
        {message ? (
          <p role={message.includes("できません") ? "alert" : "status"}>{message}</p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "登録中…" : "登録"}
        </Button>
      </form>
      <p>
        <Link to="/login">ログインへ</Link>
      </p>
    </AuthLayout>
  );
}
export function RecoverPage() {
  const [done, setDone] = useState(false);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(
      z.object({
        email: z.string().email("有効なメールアドレスを入力してください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async ({ email }) => {
    await auth.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/recover/reset`,
    });
    setDone(true);
  });
  return (
    <AuthLayout title="Reset your password." description="再設定用のメールを送信します。">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <label>
          メールアドレス
          <input
            autoComplete="email"
            aria-invalid={Boolean(form.formState.errors.email)}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
        </label>
        {done ? <p role="status">再設定メールを送信しました。メールをご確認ください。</p> : null}
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
        <label>
          新しいパスワード
          <input
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(form.formState.errors.password)}
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
        </label>
        {message ? <p role="status">{message}</p> : null}
        <Button type="submit" disabled={!token || form.formState.isSubmitting}>
          パスワードを再設定
        </Button>
      </form>
    </AuthLayout>
  );
}
