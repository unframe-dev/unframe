import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
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

export function ResetPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const form = useForm<{ password: string }>({
    resolver: zodResolver(
      z.object({
        password: z.string().min(8, "パスワードは8文字以上にしてください。"),
      }),
    ),
  });
  const submit = form.handleSubmit(async ({ password }) => {
    setMessage("");
    try {
      const result = await auth.resetPassword({ newPassword: password, token });
      if (result.error) {
        setMessage("再設定できませんでした。リンクを確認してください。");
        return;
      }
      await navigate({ to: "/login", replace: true });
    } catch {
      setMessage("再設定できませんでした。もう一度お試しください。");
    }
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
        {message ? (
          <p role="alert" className={styles["error"]}>
            {message}
          </p>
        ) : null}
        <Button type="submit" disabled={!token || form.formState.isSubmitting}>
          パスワードを再設定
        </Button>
      </form>
    </AuthLayout>
  );
}
