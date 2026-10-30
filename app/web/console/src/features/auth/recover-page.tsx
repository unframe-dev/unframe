import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthLayout } from "./auth-layout";
import { FormErrors } from "./form-errors";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import styles from "@/shared/layouts/public-pages.module.css";

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
          <p role="alert" className={styles["error"]}>
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
