import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfilePage, SecurityPage } from "./settings-pages";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
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
vi.mock("@/features/auth/control-plane-auth", () => ({
  controlPlaneAuth: auth,
}));

describe("ProfilePage", () => {
  it("updates the name and profile icon without displaying the email address", async () => {
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
    render(<ProfilePage />);
    const user = userEvent.setup();
    const name = await screen.findByDisplayValue("旧名");
    const image = screen.getByRole("textbox", { name: "アイコンURL" });

    expect(screen.queryByDisplayValue("a@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("メールアドレス")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "プロフィールアイコン" })).toHaveAttribute(
      "src",
      "https://example.test/old.png",
    );

    await user.clear(name);
    await user.type(name, "新名");
    await user.clear(image);
    await user.type(image, "https://example.test/new.png");
    expect(screen.getByRole("status")).toHaveTextContent("未保存");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(auth.updateUser).toHaveBeenCalledWith({
      name: "新名",
      image: "https://example.test/new.png",
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
    render(<ProfilePage />);
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
    render(<ProfilePage />);
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
    auth.twoFactor.enable.mockResolvedValue({ error: null });
    auth.twoFactor.getTotpUri.mockResolvedValue({
      error: null,
      data: { totpURI: "otpauth://test" },
    });
    auth.twoFactor.verifyTotp.mockResolvedValue({ error: null });
    auth.twoFactor.generateBackupCodes.mockResolvedValue({
      error: null,
      data: { backupCodes: ["ABC"] },
    });
    auth.listSessions.mockResolvedValue({
      error: null,
      data: [{ id: "s", createdAt: "now" }],
    });
    render(<SecurityPage />);
    const user = userEvent.setup();
    await user.type(screen.getAllByLabelText("現在のパスワード")[1]!, "password");
    await user.click(screen.getByRole("button", { name: "二要素認証を有効化" }));
    expect(await screen.findByText("otpauth://test")).toBeInTheDocument();
    await user.type(screen.getByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "コードを確認" }));
    expect(await screen.findByText("ABC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "セッションを更新" }));
    expect(await screen.findByText(/場所を特定/)).toBeInTheDocument();
  });
});
