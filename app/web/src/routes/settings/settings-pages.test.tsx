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

    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(
      screen.queryByText("表示名とプロフィールアイコンを設定します。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("a@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("メールアドレス")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "プロフィールアイコン" }),
    ).toHaveAttribute("src", "https://example.test/old.png");

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
    for (const number of ["01", "02", "03"]) {
      expect(screen.queryByText(number)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/SMS やメール OTP/)).not.toBeInTheDocument();
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
