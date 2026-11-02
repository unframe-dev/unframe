import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePage, SecurityPage } from "./settings-pages";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sessionKey } from "@/features/auth/control-plane-auth";
import type { ReactNode } from "react";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAccounts: vi.fn(),
  updateUser: vi.fn(),
  changePassword: vi.fn(),
  listSessions: vi.fn(),
  revokeOtherSessions: vi.fn(),
  twoFactor: {
    enable: vi.fn(),
    getTotpUri: vi.fn(),
    verifyTotp: vi.fn(),
    generateBackupCodes: vi.fn(),
    disable: vi.fn(),
  },
}));
vi.mock("@unframe/api-client-typescript", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@unframe/api-client-typescript")>()),
  createControlPlaneAuthClient: vi.fn(() => auth),
}));
const clients: QueryClient[] = [];
function renderSettings(children: ReactNode, initialSession?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (initialSession !== undefined) client.setQueryData(sessionKey, initialSession);
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  return client;
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("ProfilePage", () => {
  it("opens from a fresh canonical session without another session request", async () => {
    auth.getSession.mockClear();
    const initial = {
      user: { id: "cached-user", name: "キャッシュ済み", image: null },
      session: { expiresAt: new Date(Date.now() + 3600000) },
    };
    renderSettings(<ProfilePage />, initial);
    expect(await screen.findByDisplayValue("キャッシュ済み")).toBeInTheDocument();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it("discards the previous account's draft when the canonical principal changes", async () => {
    const initial = {
      user: { id: "first-user", name: "最初のユーザー", image: null },
      session: { expiresAt: new Date(Date.now() + 3600000) },
    };
    const client = renderSettings(<ProfilePage />, initial);
    const user = userEvent.setup();
    const name = await screen.findByDisplayValue("最初のユーザー");
    await user.clear(name);
    await user.type(name, "前のユーザーの編集");
    act(() =>
      client.setQueryData(sessionKey, {
        ...initial,
        user: { ...initial.user, id: "next-user", name: "次のユーザー" },
      }),
    );
    expect(await screen.findByDisplayValue("次のユーザー")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("前のユーザーの編集")).not.toBeInTheDocument();
  });
  it("follows canonical user updates without discarding an edited name", async () => {
    const initial = {
      user: { id: "profile-user", name: "初期名", image: null },
      session: { expiresAt: new Date(Date.now() + 3600000) },
    };
    auth.getSession.mockResolvedValue({ data: initial, error: null });
    const client = renderSettings(<ProfilePage />);
    const name = await screen.findByDisplayValue("初期名");
    act(() =>
      client.setQueryData(sessionKey, {
        ...initial,
        user: { ...initial.user, name: "別タブの更新" },
      }),
    );
    await waitFor(() => expect(name).toHaveValue("別タブの更新"));
    const user = userEvent.setup();
    await user.clear(name);
    await user.type(name, "編集中の名前");
    act(() =>
      client.setQueryData(sessionKey, {
        ...initial,
        user: { ...initial.user, name: "次の遠隔更新" },
      }),
    );
    expect(name).toHaveValue("編集中の名前");
  });
  it("updates the name and offers image selection without a URL field or email address", async () => {
    auth.getSession.mockResolvedValue({
      data: {
        user: {
          name: "旧名",
          email: "a@example.test",
          image: "https://example.test/old.png",
        },
      },
    });
    auth.updateUser.mockResolvedValue({ error: null });
    renderSettings(<ProfilePage />);
    const user = userEvent.setup();
    const name = await screen.findByDisplayValue("旧名");
    expect(screen.queryByRole("textbox", { name: "アイコンURL" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("アイコン画像を選択")).toHaveAttribute("type", "file");

    expect(screen.queryByDisplayValue("a@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("メールアドレス")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "プロフィールアイコン" })).toHaveAttribute(
      "src",
      "https://example.test/old.png",
    );

    await user.clear(name);
    await user.type(name, "新名");
    expect(screen.getByRole("status")).toHaveTextContent("未保存");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(auth.updateUser).toHaveBeenCalledWith({
      name: "新名",
    });
  });

  it("keeps edits made during a save marked as unsaved", async () => {
    let resolveUpdate!: (result: { error: null }) => void;
    auth.getSession.mockResolvedValue({
      data: { user: { name: "旧名", image: null } },
      error: null,
    });
    auth.updateUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderSettings(<ProfilePage />);
    const user = userEvent.setup();
    const name = await screen.findByDisplayValue("旧名");
    await user.clear(name);
    await user.type(name, "保存する名前");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.clear(name);
    await user.type(name, "保存後の編集");
    resolveUpdate({ error: null });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("未保存の変更があります。"),
    );
    expect(screen.queryByDisplayValue("保存する名前")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("保存後の編集")).toBeInTheDocument();
  });

  it("shows a retry action when getSession returns a structured error", async () => {
    auth.getSession
      .mockResolvedValueOnce({ data: null, error: { code: "NETWORK_ERROR" } })
      .mockResolvedValueOnce({ data: { user: { name: "回復後", image: null } }, error: null });
    renderSettings(<ProfilePage />);
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロフィールを読み込めませんでした。",
    );
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByDisplayValue("回復後")).toBeInTheDocument();
  });
});
describe("SecurityPage", () => {
  it("sets up TOTP, displays backup codes, and lists sessions", async () => {
    auth.listAccounts.mockResolvedValue({ error: null, data: [{ providerId: "credential" }] });
    auth.getSession.mockResolvedValue({
      error: null,
      data: { user: { twoFactorEnabled: false } },
    });
    auth.twoFactor.enable.mockResolvedValue({
      error: null,
      data: {
        method: "totp",
        totpURI: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP",
        backupCodes: ["ABC"],
      },
    });
    auth.twoFactor.verifyTotp.mockResolvedValue({ error: null });
    auth.listSessions.mockResolvedValue({
      error: null,
      data: [{ id: "s", createdAt: "now" }],
    });
    renderSettings(<SecurityPage />);
    const user = userEvent.setup();
    await screen.findByText("未設定", { exact: true });
    await user.type(screen.getAllByLabelText("現在のパスワード")[1]!, "password");
    await user.click(screen.getByRole("button", { name: "二要素認証を設定" }));
    expect(
      await screen.findByRole("img", { name: "認証アプリ登録用 QR コード" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "コードを確認" }));
    expect(await screen.findByText("ABC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "セッションを更新" }));
    expect(await screen.findByText(/場所を特定/)).toBeInTheDocument();
  });
});
