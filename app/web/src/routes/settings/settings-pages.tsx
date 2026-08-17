import { useEffect, useState, type FormEvent } from "react";
import { controlPlaneAuth } from "../../app/auth/control-plane-auth";
import { Button } from "../../components/ui/button";

const auth = controlPlaneAuth;
type SessionUser = NonNullable<
  Awaited<ReturnType<typeof auth.getSession>>["data"]
>["user"];
type AuthResult = { error: unknown | null };
type DeviceSession = NonNullable<
  Awaited<ReturnType<typeof auth.listSessions>>["data"]
>[number];

export function ProfilePage() {
  const [user, setUser] = useState<SessionUser>();
  const [name, setName] = useState("");
  const [state, setState] = useState("読み込み中…");
  useEffect(() => {
    void auth
      .getSession()
      .then((result) => {
        setUser(result.data?.user);
        setName(result.data?.user?.name ?? "");
        setState("");
      })
      .catch(() => setState("プロフィールを読み込めませんでした。"));
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setState("保存中…");
    const result = await auth.updateUser({ name });
    setState(result.error ? "保存できませんでした。" : "保存しました。");
    if (!result.error)
      setUser((value: SessionUser | undefined) =>
        value ? { ...value, name } : value,
      );
  };
  return (
    <main id="main-content" className="app-main">
      <header className="page-heading">
        <div className="page-heading-copy">
          <h1>プロフィール</h1>
          <p>アカウントの基本情報を管理します。</p>
        </div>
      </header>
      <section className="workspace-section">
        <header className="section-heading">
          <p className="section-number">01</p>
          <div><h2>基本情報</h2><p>表示名とログイン中のメールアドレスを確認します。</p></div>
        </header>
        <form onSubmit={save}>
          <label>
            名前
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (state !== "保存中…") setState("未保存の変更があります。");
              }}
              disabled={!user}
            />
          </label>
          <label>
            メールアドレス
            <input value={user?.email ?? ""} readOnly aria-readonly="true" />
          </label>
          <p role="status">{state}</p>
          <Button
            type="submit"
            disabled={
              !user || !name || name === user.name || state === "保存中…"
            }
          >
            保存
          </Button>
        </form>
      </section>
    </main>
  );
}

export function SecurityPage() {
  const [state, setState] = useState("");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const perform = async (task: () => Promise<AuthResult>, success: string) => {
    setState("処理中…");
    const result = await task();
    setState(
      result.error
        ? "操作できませんでした。再認証が必要な場合があります。"
        : success,
    );
    return result;
  };
  const beginTotp = async () => {
    const result = await perform(
      () => auth.twoFactor.enable({ password }),
      "認証アプリに URI を登録し、コードを確認してください。",
    );
    if (!result.error) {
      const uriResult = await auth.twoFactor.getTotpUri({ password });
      if (!uriResult.error && uriResult.data) setUri(uriResult.data.totpURI);
    }
  };
  const verifyTotp = async () => {
    const result = await perform(
      () => auth.twoFactor.verifyTotp({ code }),
      "二要素認証を有効化しました。",
    );
    if (!result.error) {
      const codes = await auth.twoFactor.generateBackupCodes({ password });
      if (!codes.error && codes.data) setBackupCodes(codes.data.backupCodes);
    }
  };
  const loadSessions = async () => {
    const result = await auth.listSessions();
    setSessions(result.data ?? null);
    setState(
      result.error
        ? "セッションを読み込めませんでした。"
        : "セッションを更新しました。",
    );
  };
  return (
    <main id="main-content" className="app-main">
      <header className="page-heading">
        <div className="page-heading-copy">
          <h1>セキュリティー</h1>
          <p>重要な操作には現在のパスワードでの再認証が必要です。</p>
        </div>
      </header>
      <section className="workspace-section">
        <header className="section-heading"><p className="section-number">01</p><div><h2>パスワード</h2><p>認証情報を更新し、他のセッションを終了します。</p></div></header>
        <PasswordChange perform={perform} />
      </section>
      <section className="workspace-section">
        <header className="section-heading"><p className="section-number">02</p><div><h2>二要素認証</h2><p>認証アプリを使用します。SMS やメール OTP は設定されていません。</p></div></header>
        <label>
          現在のパスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button disabled={!password} onClick={() => void beginTotp()}>
          二要素認証を有効化
        </Button>
        {uri ? (
          <>
            <p>認証アプリに次の URI を登録してください。</p>
            <code>{uri}</code>
            <label>
              認証コード
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
              />
            </label>
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
          variant="outline"
          disabled={!password}
          onClick={() =>
            void perform(
              () => auth.twoFactor.disable({ password }),
              "二要素認証を無効化しました。",
            )
          }
        >
          二要素認証を無効化
        </Button>
      </section>
      <section className="workspace-section">
        <header className="section-heading"><p className="section-number">03</p><div><h2>セッション</h2><p>ログイン中のデバイスを確認し、不要な接続を終了します。</p></div></header>
        <Button variant="outline" onClick={() => void loadSessions()}>
          セッションを更新
        </Button>
        {sessions ? (
          <ul className="resource-list">
            {sessions.map((session: DeviceSession) => (
              <li key={session.id}>
                <p>
                  {session.ipAddress ?? "場所を特定できません"} ·{" "}
                  {session.createdAt}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          variant="outline"
          onClick={() =>
            void perform(
              () => auth.revokeOtherSessions(),
              "他のセッションを終了しました。",
            )
          }
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
  perform: (
    task: () => Promise<AuthResult>,
    success: string,
  ) => Promise<AuthResult>;
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
      <label>
        現在のパスワード
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </label>
      <label>
        新しいパスワード
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      <Button type="submit">パスワードを変更</Button>
    </form>
  );
}
