import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthLayout } from "./auth-layout";
import { FormErrors } from "./form-errors";
import { Link } from "@tanstack/react-router";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { credentialsSchema, type Credentials } from "./auth-validation";
import { GoogleSignIn } from "./google-sign-in";
import { VerificationResend, verificationCallbackUrl } from "./verification-resend";
import signupWaveUrl from "./signup-wave.svg?url";
import signupStyles from "./signup-page.module.css";
import styles from "@/shared/layouts/public-pages.module.css";

export function SignupPage() {
  const [message, setMessage] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const form = useForm<Credentials & { name: string }>({
    resolver: zodResolver(
      credentialsSchema.extend({
        name: z.string().trim().min(1, "ユーザーネームを入力してください。"),
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
    <AuthLayout
      title="Sign up."
      className={signupStyles["page"]!}
      decoration={
        <div className={signupStyles["artwork"]!} aria-hidden="true">
          <img src={signupWaveUrl} alt="" width={1600} height={800} />
        </div>
      }
    >
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
        <form onSubmit={submit}>
          <FormErrors errors={form.formState.errors} />
          <Label>
            ユーザーネーム
            <Input
              autoComplete="nickname"
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
            <p role="alert" className={styles["error"]}>
              {message}
            </p>
          ) : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "登録中…" : "登録"}
          </Button>
        </form>
      )}
      {!registeredEmail ? (
        <>
          <div className={styles["divider"]} aria-hidden="true">
            or
          </div>
          <GoogleSignIn label="Google で登録" />
        </>
      ) : null}
      <p>
        <Link to="/login">ログインへ</Link>
      </p>
    </AuthLayout>
  );
}
