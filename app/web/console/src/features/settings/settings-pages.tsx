import { Skeleton } from "@/shared/ui/skeleton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  controlPlaneAuth,
  useAuthSession,
  updateSessionUser,
  type AuthSession,
} from "@/features/auth/control-plane-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notifySessionChanged, principalRevision } from "@/shared/api/session-events";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import contentModuleStyles from "@/app/shell/application-content.module.css";
import moduleStyles from "./settings-pages.module.css";
import { TwoFactorSettings } from "./two-factor-settings";
import { ProfileImageEditor } from "./profile-image-editor";
import { updateProfileImage } from "./profile-image-api";
const styles = {
  main: contentModuleStyles["main"]!,
  heading: contentModuleStyles["heading"]!,
  section: moduleStyles["section"]!,
  sectionHeading: moduleStyles["sectionHeading"]!,
  profileEditor: moduleStyles["profileEditor"]!,
  error: moduleStyles["error"]!,
  list: moduleStyles["list"]!,
};

const auth = controlPlaneAuth;
type AuthResult = { error: unknown | null };

export function ProfilePage() {
  const session = useAuthSession();
  const user = session.data?.user;
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.heading}>
        <h1>プロフィール</h1>
      </header>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>基本情報</h2>
        </header>
        {!user && session.isPending ? (
          <div
            role="status"
            aria-label="プロフィールを読み込んでいます…"
            className="grid max-w-[560px] gap-[18px]"
          >
            <div className="flex items-center gap-4">
              <Skeleton className="size-20 shrink-0 rounded-full" />
              <Skeleton className="h-12 w-32" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-24" />
          </div>
        ) : !user ? (
          <div>
            <p role="alert" className={styles.error}>
              プロフィールを読み込めませんでした。
            </p>
            <Button type="button" variant="outline" onClick={() => void session.refetch()}>
              再試行
            </Button>
          </div>
        ) : (
          <ProfileForm key={user.id} user={user} />
        )}
      </section>
    </main>
  );
}

function ProfileForm({ user }: { user: AuthSession["user"] }) {
  const client = useQueryClient();
  const [nameDraft, setNameDraft] = useState<string>();
  const name = nameDraft ?? user.name;
  const [imageChange, setImageChange] = useState<Blob | null>();
  const [preview, setPreview] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const draft = useRef<string | undefined>(undefined);
  const savingRef = useRef(false);
  const dirty = name.trim() !== user.name || imageChange !== undefined;
  useEffect(() => {
    if (!imageChange) return;
    const url = URL.createObjectURL(imageChange);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageChange]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const submitted = { name: name.trim(), image: imageChange };
    const principal = principalRevision();
    savingRef.current = true;
    setSaving(true);
    setState("保存中…");
    try {
      if (submitted.image !== undefined) {
        const image = await updateProfileImage(submitted.image);
        if (principal !== principalRevision()) return;
        updateSessionUser(client, user.id, { image });
        setImageChange(undefined);
        notifySessionChanged();
      }
      if (submitted.name !== user.name) {
        const result = await auth.updateUser({ name: submitted.name });
        if (result.error) throw result.error;
        if (principal !== principalRevision()) return;
        updateSessionUser(client, user.id, { name: submitted.name });
      }
      const unchanged = draft.current === undefined || draft.current.trim() === submitted.name;
      if (unchanged) {
        draft.current = undefined;
        setNameDraft(undefined);
      }
      setState(unchanged ? "保存しました。" : "未保存の変更があります。");
    } catch {
      setState("保存できませんでした。もう一度お試しください。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <div className={styles.profileEditor}>
      <form onSubmit={save}>
        <ProfileImageEditor
          image={imageChange === null ? "" : imageChange ? preview : (user.image ?? "")}
          name={name}
          disabled={saving}
          onChange={(image) => {
            setImageChange(image);
            setState("未保存の変更があります。");
          }}
        />
        <Label>
          名前
          <Input
            value={name}
            onChange={(event) => {
              setNameDraft(event.target.value);
              draft.current = event.target.value;
              setState("未保存の変更があります。");
            }}
            autoComplete="name"
          />
        </Label>
        <p role="status">{state || (dirty ? "未保存の変更があります。" : "")}</p>
        <Button type="submit" disabled={!name.trim() || !dirty || saving}>
          保存
        </Button>
      </form>
    </div>
  );
}

export function SecurityPage() {
  const [state, setState] = useState("");
  const session = useAuthSession();
  const user = session.data?.user;
  const accounts = useQuery({
    queryKey: ["auth", "accounts", user?.id],
    queryFn: async ({ signal }) => {
      const result = await auth.listAccounts({ fetchOptions: { signal } });
      if (result.error || !result.data) throw result.error ?? new Error("Account lookup failed");
      return result.data;
    },
    enabled: Boolean(user),
    retry: false,
  });
  const sessionList = useQuery({
    queryKey: ["auth", "security-sessions", user?.id],
    queryFn: async ({ signal }) => {
      const result = await auth.listSessions({ fetchOptions: { signal } });
      if (result.error || !result.data) throw result.error ?? new Error("Session lookup failed");
      return result.data;
    },
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const sessions = sessionList.data;
  const account =
    user && accounts.data
      ? {
          user,
          hasPassword: accounts.data.some((value) => value.providerId === "credential"),
          googleLinked: accounts.data.some((value) => value.providerId === "google"),
        }
      : undefined;
  const loading = !account && (session.isPending || (Boolean(user) && accounts.isPending));
  const failed = session.isError || accounts.isError || (!session.isPending && !user);
  const retry = async () => {
    const result = await session.refetch();
    if (result.data) await accounts.refetch();
  };
  const perform = async (task: () => Promise<AuthResult>, success: string) => {
    setState("処理中…");
    const result = await task();
    setState(result.error ? "操作できませんでした。再認証が必要な場合があります。" : success);
    return result;
  };
  const loadSessions = async () => {
    const result = await sessionList.refetch();
    setState(result.isError ? "セッションを読み込めませんでした。" : "セッションを更新しました。");
  };
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.heading}>
        <h1>セキュリティー</h1>
      </header>
      {loading ? (
        <div role="status" aria-label="認証設定を読み込み中…" className="grid gap-10 py-8">
          {[0, 1].map((section) => (
            <div key={section} className="grid max-w-[560px] gap-[18px]">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-36" />
            </div>
          ))}
        </div>
      ) : null}
      {failed ? (
        <div>
          <p role="alert" className={styles.error}>
            認証設定を読み込めませんでした。
          </p>
          <Button variant="outline" onClick={() => void retry()}>
            再試行
          </Button>
        </div>
      ) : null}
      {account !== undefined ? (
        <>
          <section className={styles.section} aria-labelledby="password-heading">
            <header className={styles.sectionHeading}>
              <h2 id="password-heading">パスワード</h2>
            </header>
            {account.hasPassword ? (
              <PasswordChange key={account.user.id} perform={perform} />
            ) : (
              <PasswordSetup key={account.user.id} email={account.user.email} />
            )}
          </section>
          <TwoFactorSettings
            key={account.user.id}
            initialEnabled={Boolean(account.user.twoFactorEnabled)}
            hasPassword={account.hasPassword}
            googleLinked={account.googleLinked}
          />
        </>
      ) : null}
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>セッション</h2>
        </header>
        <Button
          variant="outline"
          disabled={!user || sessionList.isFetching}
          onClick={() => void loadSessions()}
        >
          セッションを更新
        </Button>
        {sessions ? (
          <ul className={styles.list}>
            {sessions.map((session) => (
              <li key={session.id}>
                <p>
                  {session.ipAddress ?? "場所を特定できません"} ·{" "}
                  {session.createdAt.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          variant="outline"
          onClick={() =>
            void perform(() => auth.revokeOtherSessions(), "他のセッションを終了しました。")
          }
        >
          他のセッションを終了
        </Button>
      </section>
      {state ? <p role="status">{state}</p> : null}
    </main>
  );
}
function PasswordSetup({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const send = async () => {
    setState("sending");
    try {
      const result = await auth.requestPasswordReset({
        email,
        redirectTo: new URL("/recover/reset", window.location.origin).href,
      });
      setState(result.error ? "error" : "sent");
    } catch {
      setState("error");
    }
  };
  return (
    <div className={moduleStyles["securityEditor"]}>
      <p>Unframe用のパスワードは未設定です。</p>
      <p>
        パスワードでのログインも利用する場合は、登録メールアドレスに設定メールを送信してください。
      </p>
      <Button disabled={state === "sending" || state === "sent"} onClick={() => void send()}>
        {state === "sending" ? "送信中…" : "パスワード設定メールを送信"}
      </Button>
      {state === "sent" ? (
        <p role="status">
          設定メールを送信しました。メール内のリンクからパスワードを設定してください。
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert" className={styles.error}>
          設定メールを送信できませんでした。もう一度お試しください。
        </p>
      ) : null}
    </div>
  );
}
function PasswordChange({
  perform,
}: {
  perform: (task: () => Promise<AuthResult>, success: string) => Promise<AuthResult>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void perform(
          () =>
            auth.changePassword({
              currentPassword,
              newPassword,
              revokeOtherSessions: true,
            }),
          "パスワードを変更し、他のセッションを終了しました。",
        );
      }}
    >
      <Label>
        現在のパスワード
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </Label>
      <Label>
        新しいパスワード
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
        />
      </Label>
      <Button type="submit">パスワードを変更</Button>
    </form>
  );
}
