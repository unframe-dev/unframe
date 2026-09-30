import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { controlPlaneAuth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import contentModuleStyles from "@/app/shell/application-content.module.css";
import moduleStyles from "./settings-pages.module.css";
const styles = {
  error: moduleStyles["error"]!,
  heading: contentModuleStyles["heading"]!,
  headingCopy: moduleStyles["headingCopy"]!,
  imageHelp: moduleStyles["imageHelp"]!,
  list: moduleStyles["list"]!,
  main: contentModuleStyles["main"]!,
  profileEditor: moduleStyles["profileEditor"]!,
  profileIcon: moduleStyles["profileIcon"]!,
  section: moduleStyles["section"]!,
  sectionHeading: moduleStyles["sectionHeading"]!,
};

const auth = controlPlaneAuth;
type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.getSession>>["data"]>["user"];
type AuthResult = { error: unknown | null };
type DeviceSession = NonNullable<Awaited<ReturnType<typeof auth.listSessions>>["data"]>[number];

export function ProfilePage() {
  const [user, setUser] = useState<SessionUser>();
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [state, setState] = useState("読み込み中…");
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const draft = useRef({ image: "", name: "" });
  const loadProfile = useCallback(() => {
    setLoadFailed(false);
    setState("読み込み中…");
    void auth
      .getSession()
      .then((result) => {
        if (result.error) {
          throw result.error;
        }
        setUser(result.data?.user);
        const nextDraft = {
          image: result.data?.user?.image ?? "",
          name: result.data?.user?.name ?? "",
        };
        draft.current = nextDraft;
        setName(nextDraft.name);
        setImage(nextDraft.image);
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
    const submitted = { image: image.trim(), name: name.trim() };
    setSaving(true);
    setState("保存中…");
    const nextImage = submitted.image || null;
    const result = await auth.updateUser({ image: nextImage, name: submitted.name });
    setSaving(false);
    if (result.error) {
      setState("保存できませんでした。");
    } else {
      setUser((value: SessionUser | undefined) =>
        value ? { ...value, image: nextImage, name: submitted.name } : value,
      );
      setState(
        draft.current.name === submitted.name && draft.current.image === submitted.image
          ? "保存しました。"
          : "未保存の変更があります。",
      );
    }
  };
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.heading}>
        <div className={styles.headingCopy}>
          <h1>プロフィール</h1>
          <p>アカウントの基本情報を管理します。</p>
        </div>
      </header>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>基本情報</h2>
        </header>
        <div className={styles.profileEditor}>
          <ProfileIcon image={image.trim()} name={name} />
          <form onSubmit={save}>
            <Label>
              名前
              <Input
                autoComplete="name"
                disabled={!user}
                onChange={(e) => {
                  setName(e.target.value);
                  draft.current.name = e.target.value;
                  setState("未保存の変更があります。");
                }}
                value={name}
              />
            </Label>
            <Label>
              アイコンURL
              <Input
                disabled={!user}
                inputMode="url"
                onChange={(event) => {
                  setImage(event.target.value);
                  draft.current.image = event.target.value;
                  setState("未保存の変更があります。");
                }}
                placeholder="https://example.com/avatar.png"
                type="url"
                value={image}
              />
            </Label>
            <p className={styles.imageHelp}>空欄にするとアイコンを解除します。</p>
            {loadFailed ? (
              <div>
                <p className={styles.error} role="alert">
                  {state}
                </p>
                <Button onClick={loadProfile} type="button" variant="outline">
                  再試行
                </Button>
              </div>
            ) : (
              <p role="status">{state}</p>
            )}
            <Button
              disabled={
                !user ||
                !name.trim() ||
                (name.trim() === user.name && image.trim() === (user.image ?? "")) ||
                saving
              }
              type="submit"
            >
              保存
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

function ProfileIcon({ image, name }: { image: string; name: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [image]);

  return (
    <div className={styles.profileIcon}>
      {image && !failed ? (
        <img alt="プロフィールアイコン" onError={() => setFailed(true)} src={image} />
      ) : (
        <span aria-label="プロフィールアイコン">
          {name.trim().charAt(0).toLocaleUpperCase() || "U"}
        </span>
      )}
    </div>
  );
}

export function SecurityPage() {
  const [state, setState] = useState("");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<Array<string>>([]);
  const [code, setCode] = useState("");
  const [sessions, setSessions] = useState<Array<DeviceSession> | null>(null);
  const perform = async (task: () => Promise<AuthResult>, success: string) => {
    setState("処理中…");
    const result = await task();
    setState(result.error ? "操作できませんでした。再認証が必要な場合があります。" : success);
    return result;
  };
  const beginTotp = async () => {
    const result = await perform(
      () => auth.twoFactor.enable({ password }),
      "認証アプリに URI を登録し、コードを確認してください。",
    );
    if (!result.error) {
      const uriResult = await auth.twoFactor.getTotpUri({ password });
      if (!uriResult.error && uriResult.data) {
        setUri(uriResult.data.totpURI);
      }
    }
  };
  const verifyTotp = async () => {
    const result = await perform(
      () => auth.twoFactor.verifyTotp({ code }),
      "二要素認証を有効化しました。",
    );
    if (!result.error) {
      const codes = await auth.twoFactor.generateBackupCodes({ password });
      if (!codes.error && codes.data) {
        setBackupCodes(codes.data.backupCodes);
      }
    }
  };
  const loadSessions = async () => {
    const result = await auth.listSessions();
    setSessions(result.data ?? null);
    setState(result.error ? "セッションを読み込めませんでした。" : "セッションを更新しました。");
  };
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.heading}>
        <div className={styles.headingCopy}>
          <h1>セキュリティー</h1>
          <p>重要な操作には現在のパスワードでの再認証が必要です。</p>
        </div>
      </header>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>パスワード</h2>
        </header>
        <PasswordChange perform={perform} />
      </section>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>二要素認証</h2>
        </header>
        <Label>
          現在のパスワード
          <Input onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
        </Label>
        <Button disabled={!password} onClick={() => void beginTotp()}>
          二要素認証を有効化
        </Button>
        {uri ? (
          <>
            <p>認証アプリに次の URI を登録してください。</p>
            <code>{uri}</code>
            <Label>
              認証コード
              <Input
                autoComplete="one-time-code"
                onChange={(e) => setCode(e.target.value)}
                value={code}
              />
            </Label>
            <Button disabled={!code} onClick={() => void verifyTotp()}>
              コードを確認
            </Button>
          </>
        ) : null}
        {backupCodes.length ? (
          <div>
            <h3>バックアップコード</h3>
            <p>この画面を閉じる前に安全な場所へ保管してください。</p>
            <ul>
              {backupCodes.map((backupCode) => (
                <li key={backupCode}>
                  <code>{backupCode}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button
          disabled={!password}
          onClick={() =>
            void perform(() => auth.twoFactor.disable({ password }), "二要素認証を無効化しました。")
          }
          variant="outline"
        >
          二要素認証を無効化
        </Button>
      </section>
      <section className={styles.section}>
        <header className={styles.sectionHeading}>
          <h2>セッション</h2>
        </header>
        <Button onClick={() => void loadSessions()} variant="outline">
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
          onClick={() =>
            void perform(() => auth.revokeOtherSessions(), "他のセッションを終了しました。")
          }
          variant="outline"
        >
          他のセッションを終了
        </Button>
      </section>
      {state ? <p role="status">{state}</p> : null}
    </main>
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
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </Label>
      <Label>
        新しいパスワード
        <Input
          minLength={8}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </Label>
      <Button type="submit">パスワードを変更</Button>
    </form>
  );
}
