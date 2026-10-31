import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { controlPlaneAuth } from "@/features/auth/control-plane-auth";
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
type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.getSession>>["data"]>["user"];
type AuthResult = { error: unknown | null };
type DeviceSession = NonNullable<Awaited<ReturnType<typeof auth.listSessions>>["data"]>[number];
type SecurityAccountState =
  | { status: "loading" | "error" }
  | { status: "ready"; user: SessionUser; hasPassword: boolean; googleLinked: boolean };

export function ProfilePage() {
  const [user, setUser] = useState<SessionUser>();
  const [name, setName] = useState("");
  const [imageChange, setImageChange] = useState<Blob | null>();
  const [preview, setPreview] = useState("");
  const [state, setState] = useState("読み込み中…");
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const draft = useRef({ name: "" });
  const savingRef = useRef(false);
  useEffect(() => {
    if (!imageChange) return;
    const url = URL.createObjectURL(imageChange);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageChange]);
  const loadProfile = useCallback(() => {
    setLoadFailed(false);
    setState("読み込み中…");
    void auth
      .getSession()
      .then((result) => {
        if (result.error) throw result.error;
        setUser(result.data?.user);
        const nextDraft = {
          name: result.data?.user?.name ?? "",
        };
        draft.current = nextDraft;
        setName(nextDraft.name);
        setImageChange(undefined);
        setState("");
      })
      .catch(() => {
        setLoadFailed(true);
        setState("プロフィールを読み込めませんでした。");
      });
  }, []);
  useEffect(() => loadProfile(), [loadProfile]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || savingRef.current) return;
    const submitted = { name: name.trim(), image: imageChange };
    savingRef.current = true;
    setSaving(true);
    setState("保存中…");
    try {
      if (submitted.image !== undefined) {
        const image = await updateProfileImage(submitted.image);
        setUser((value: SessionUser | undefined) => (value ? { ...value, image } : value));
        setImageChange(undefined);
        void auth.useSession.get().refetch();
      }
      if (submitted.name !== user.name) {
        const result = await auth.updateUser({ name: submitted.name });
        if (result.error) throw result.error;
        setUser((value: SessionUser | undefined) =>
          value ? { ...value, name: submitted.name } : value,
        );
      }
      setState(
        draft.current.name.trim() === submitted.name
          ? "保存しました。"
          : "未保存の変更があります。",
      );
    } catch {
      setState("保存できませんでした。もう一度お試しください。");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.heading}>
        <h1>プロフィール</h1>
      </header>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>基本情報</h2>
        </header>
        <div className={styles.profileEditor}>
          <form onSubmit={save}>
            <ProfileImageEditor
              image={imageChange === null ? "" : imageChange ? preview : (user?.image ?? "")}
              name={name}
              disabled={!user || saving}
              onChange={(image) => {
                setImageChange(image);
                setState("未保存の変更があります。");
              }}
            />
            <Label>
              名前
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  draft.current.name = e.target.value;
                  setState("未保存の変更があります。");
                }}
                disabled={!user}
                autoComplete="name"
              />
            </Label>
            {loadFailed ? (
              <div>
                <p role="alert" className={styles.error}>
                  {state}
                </p>
                <Button type="button" variant="outline" onClick={loadProfile}>
                  再試行
                </Button>
              </div>
            ) : (
              <p role="status">{state}</p>
            )}
            <Button
              type="submit"
              disabled={
                !user ||
                !name.trim() ||
                (name.trim() === user.name && imageChange === undefined) ||
                saving
              }
            >
              保存
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

export function SecurityPage() {
  const [state, setState] = useState("");
  const [account, setAccount] = useState<SecurityAccountState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  useEffect(() => {
    let active = true;
    setAccount({ status: "loading" });
    void Promise.all([auth.getSession(), auth.listAccounts()]).then(
      ([session, accounts]) => {
        if (!active) return;
        if (session.error || !session.data || accounts.error || !accounts.data) {
          setAccount({ status: "error" });
          return;
        }
        setAccount({
          status: "ready",
          user: session.data.user,
          hasPassword: accounts.data.some((value) => value.providerId === "credential"),
          googleLinked: accounts.data.some((value) => value.providerId === "google"),
        });
      },
      () => {
        if (active) setAccount({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [retry]);
  const perform = async (task: () => Promise<AuthResult>, success: string) => {
    setState("処理中…");
    const result = await task();
    setState(result.error ? "操作できませんでした。再認証が必要な場合があります。" : success);
    return result;
  };
  const loadSessions = async () => {
    const result = await auth.listSessions();
    setSessions(result.data ?? null);
    setState(result.error ? "セッションを読み込めませんでした。" : "セッションを更新しました。");
  };
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.heading}>
        <h1>セキュリティー</h1>
      </header>
      {account.status === "loading" ? <p role="status">認証設定を読み込み中…</p> : null}
      {account.status === "error" ? (
        <div>
          <p role="alert" className={styles.error}>
            認証設定を読み込めませんでした。
          </p>
          <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
            再試行
          </Button>
        </div>
      ) : null}
      {account.status === "ready" ? (
        <>
          <section className={styles.section} aria-labelledby="password-heading">
            <header className={styles.sectionHeading}>
              <h2 id="password-heading">パスワード</h2>
            </header>
            {account.hasPassword ? (
              <PasswordChange perform={perform} />
            ) : (
              <PasswordSetup email={account.user.email} />
            )}
          </section>
          <TwoFactorSettings
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
        <Button variant="outline" onClick={() => void loadSessions()}>
          セッションを更新
        </Button>
        {sessions ? (
          <ul className={styles.list}>
            {sessions.map((session: DeviceSession) => (
              <li key={session.id}>
                <p>
                  {session.ipAddress ?? "場所を特定できません"} · {session.createdAt}
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
