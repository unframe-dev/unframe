import { render, screen } from "@testing-library/react";
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
vi.mock("../../app/auth/control-plane-auth", () => ({
  controlPlaneAuth: auth,
}));

describe("ProfilePage", () => {
  it("loads a profile and persists a dirty name", async () => {
    auth.getSession.mockResolvedValue({
      data: { user: { name: "旧名", email: "a@example.test" } },
    });
    auth.updateUser.mockResolvedValue({ error: null });
    render(<ProfilePage />);
    const user = userEvent.setup();
    const name = await screen.findByDisplayValue("旧名");
    await user.clear(name);
    await user.type(name, "新名");
    expect(screen.getByRole("status")).toHaveTextContent("未保存");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(auth.updateUser).toHaveBeenCalledWith({ name: "新名" });
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
    await user.click(
      screen.getByRole("button", { name: "二要素認証を有効化" }),
    );
    expect(await screen.findByText("otpauth://test")).toBeInTheDocument();
    await user.type(screen.getByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "コードを確認" }));
    expect(await screen.findByText("ABC")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "セッションを更新" }));
    expect(await screen.findByText(/場所を特定/)).toBeInTheDocument();
  });
});
