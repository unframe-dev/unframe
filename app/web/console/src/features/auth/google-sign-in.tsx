import { useState } from "react";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import googleLogoUrl from "./google-g.png?url";
import styles from "@/shared/layouts/public-pages.module.css";

export function GoogleSignIn({ label }: { label: string }) {
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
      <Button
        type="button"
        variant="outline"
        className="bg-white text-[#1f1f1f] hover:bg-white hover:text-[#1f1f1f]"
        disabled={loading}
        onClick={() => void signIn()}
      >
        <img
          src={googleLogoUrl}
          alt=""
          width={20}
          height={20}
          className="size-5 shrink-0 object-contain"
        />
        {loading ? "Google に接続中…" : label}
      </Button>
      {message ? (
        <p role="alert" className={styles["error"]}>
          {message}
        </p>
      ) : null}
    </>
  );
}
