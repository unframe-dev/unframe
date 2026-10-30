import { useState } from "react";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import styles from "@/shared/layouts/public-pages.module.css";

export function verificationCallbackUrl() {
  return new URL("/login?verified=true", window.location.origin).href;
}

export function VerificationResend({ email }: { email: string }) {
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
        <p role="alert" className={styles["error"]}>
          確認メールを再送できませんでした。もう一度お試しください。
        </p>
      ) : null}
    </div>
  );
}
