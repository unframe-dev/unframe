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
