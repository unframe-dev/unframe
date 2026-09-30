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
  copy: moduleStyles["copy"]!,
  divider: moduleStyles["divider"]!,
  error: moduleStyles["error"]!,
  form: moduleStyles["form"]!,
  header: moduleStyles["header"]!,
  lede: moduleStyles["lede"]!,
  main: moduleStyles["main"]!,
  panel: moduleStyles["panel"]!,
};

const credentialsSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください。"),
  password: z.string().min(8, "パスワードは8文字以上にしてください。"),
});
type Credentials = z.infer<typeof credentialsSchema>;
const auth = controlPlaneAuth;
function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function AuthLayout({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <main className={styles.main} id="main-content">
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
    <div className={styles.error} role="alert">
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
      setMessage(
        hasErrorCode(result.error, "EMAIL_NOT_VERIFIED")
          ? "メールアドレスを確認してください。"
          : "ログインできませんでした。入力内容を確認してください。",
      );
      return;
    }
    await navigate({ to: "/home" });
  });
  const google = async () => {
    setMessage("");
    const result = await auth.signIn.social({
      callbackURL: "/home",
      provider: "google",
    });
    if (result.error) {
      setMessage("Google ログインを開始できませんでした。");
    }
  };
  return (
    <AuthLayout description="Unframe にログインします。" title="Sign in.">
      {mfa ? (
        <MfaForm onDone={() => void navigate({ to: "/home" })} />
      ) : (
        <>
          <Button onClick={() => void google()} type="button">
            <GoogleLogoIcon aria-hidden="true" />
            Google でログイン
          </Button>
          <p className={styles.divider}>または</p>
          <form onSubmit={submit}>
            <FormErrors errors={form.formState.errors} />
            <Label>
              メールアドレス
              <Input
                aria-describedby={form.formState.errors.email ? "email-error" : undefined}
                aria-invalid={Boolean(form.formState.errors.email)}
                autoComplete="email"
                {...form.register("email")}
              />
            </Label>
            <Label>
              パスワード
              <Input
                aria-describedby={form.formState.errors.password ? "password-error" : undefined}
                aria-invalid={Boolean(form.formState.errors.password)}
                autoComplete="current-password"
                type="password"
                {...form.register("password")}
              />
            </Label>
            {message ? (
              <p className={styles.error} role="alert">
                {message}
              </p>
            ) : null}
            <Button disabled={form.formState.isSubmitting} type="submit">
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
    if (loading) {
      return;
    }
    setLoading(true);
    const result =
      method === "totp"
        ? await auth.twoFactor.verifyTotp({ code, trustDevice: false })
        : await auth.twoFactor.verifyBackupCode({ code, trustDevice: false });
    setLoading(false);
    if (result.error) {
      setMessage("コードを確認してください。");
    } else {
      onDone();
    }
  };
  return (
    <form onSubmit={submit}>
      <p>二要素認証が必要です。認証アプリのコード、またはバックアップコードを入力してください。</p>
      <Label>
        確認方法
        <Select
          onChange={(event) => setMethod(event.target.value as "totp" | "backup")}
          value={method}
        >
          <option value="totp">認証アプリ</option>
          <option value="backup">バックアップコード</option>
        </Select>
      </Label>
      <Label>
        {method === "totp" ? "認証コード" : "バックアップコード"}
        <Input
          autoComplete="one-time-code"
          onChange={(e) => setCode(e.target.value)}
          required
          value={code}
        />
      </Label>
      {message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}
      <Button disabled={loading} type="submit">
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
    <AuthLayout description="新しいアカウントを作成します。" title="Create an account.">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <Label>
          名前
          <Input
            aria-describedby={form.formState.errors.name ? "name-error" : undefined}
            aria-invalid={Boolean(form.formState.errors.name)}
            {...form.register("name")}
          />
        </Label>
        <Label>
          メールアドレス
          <Input
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            aria-invalid={Boolean(form.formState.errors.email)}
            autoComplete="email"
            {...form.register("email")}
          />
        </Label>
        <Label>
          パスワード
          <Input
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            aria-invalid={Boolean(form.formState.errors.password)}
            autoComplete="new-password"
            type="password"
            {...form.register("password")}
          />
        </Label>
        {message ? (
          <p role={message.includes("できません") ? "alert" : "status"}>{message}</p>
        ) : null}
        <Button disabled={form.formState.isSubmitting} type="submit">
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
    if (result.error) {
      setMessage("再設定メールを送信できませんでした。");
    } else {
      setDone(true);
    }
  });
  return (
    <AuthLayout description="再設定用のメールを送信します。" title="Reset your password.">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <Label>
          メールアドレス
          <Input
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            aria-invalid={Boolean(form.formState.errors.email)}
            autoComplete="email"
            {...form.register("email")}
          />
        </Label>
        {done ? <p role="status">再設定メールを送信しました。メールをご確認ください。</p> : null}
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
        <Button disabled={form.formState.isSubmitting} type="submit">
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
    <AuthLayout description="新しいパスワードを設定します。" title="Choose a password.">
      <form onSubmit={submit}>
        <FormErrors errors={form.formState.errors} />
        <Label>
          新しいパスワード
          <Input
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            aria-invalid={Boolean(form.formState.errors.password)}
            autoComplete="new-password"
            type="password"
            {...form.register("password")}
          />
        </Label>
        {message ? <p role="status">{message}</p> : null}
        <Button disabled={!token || form.formState.isSubmitting} type="submit">
          パスワードを再設定
        </Button>
      </form>
    </AuthLayout>
  );
}
