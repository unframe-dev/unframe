import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LoginPage, RecoverPage, SignupPage } from "./auth-pages";
const auth = vi.hoisted(() => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
}));
vi.mock("@/features/auth/control-plane-auth", () => ({
  controlPlaneAuth: auth,
}));
function renderRoute(Component: () => ReactNode) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: Component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}
describe("auth pages", () => {
  it("validates login fields", async () => {
    renderRoute(LoginPage);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("入力内容");
    expect(screen.getByLabelText("メールアドレス")).toHaveAttribute(
      "aria-describedby",
      "email-error",
    );
    expect(screen.getByLabelText("パスワード")).toHaveAttribute(
      "aria-describedby",
      "password-error",
    );
  });
  it("uses the selected MFA verification method", async () => {
    auth.signIn.email.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
      error: null,
    });
    auth.twoFactor.verifyTotp.mockResolvedValue({ error: { code: "invalid" } });
    auth.twoFactor.verifyBackupCode.mockResolvedValue({
      error: { code: "invalid" },
    });
    renderRoute(LoginPage);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "u@example.test");
    await user.type(screen.getByLabelText("パスワード"), "password");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    await user.type(await screen.findByLabelText("認証コード"), "123456");
    await user.click(screen.getByRole("button", { name: "確認" }));
    await waitFor(() =>
      expect(auth.twoFactor.verifyTotp).toHaveBeenCalledWith({
        code: "123456",
        trustDevice: false,
      }),
    );

    await user.selectOptions(screen.getByLabelText("確認方法"), "backup");
    await user.clear(screen.getByLabelText("バックアップコード"));
    await user.type(screen.getByLabelText("バックアップコード"), "BACKUP");
    await user.click(screen.getByRole("button", { name: "確認" }));
    await waitFor(() =>
      expect(auth.twoFactor.verifyBackupCode).toHaveBeenCalledWith({
        code: "BACKUP",
        trustDevice: false,
      }),
    );
  });
  it("submits signup and recovery", async () => {
    auth.signUp.email.mockResolvedValue({ error: null });
    renderRoute(SignupPage);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("名前"), "U");
    await user.type(await screen.findByLabelText("メールアドレス"), "u@example.test");
    await user.type(await screen.findByLabelText("パスワード"), "password");
    await user.click(await screen.findByRole("button", { name: "登録" }));
    expect(await screen.findByText(/確認メール/)).toBeInTheDocument();
  });
  it("requests password recovery", async () => {
    auth.requestPasswordReset.mockResolvedValue({ error: null });
    renderRoute(RecoverPage);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "u@example.test");
    await user.click(await screen.findByRole("button", { name: /送信/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("再設定メール");
  });
  it("does not treat a failed password recovery request as sent", async () => {
    auth.requestPasswordReset.mockResolvedValue({ error: { code: "REQUEST_FAILED" } });
    renderRoute(RecoverPage);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "u@example.test");
    await user.click(await screen.findByRole("button", { name: /送信/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "再設定メールを送信できませんでした。",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("distinguishes an unverified account from invalid credentials", async () => {
    auth.signIn.email.mockResolvedValue({ error: { code: "EMAIL_NOT_VERIFIED" } });
    renderRoute(LoginPage);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("メールアドレス"), "u@example.test");
    await user.type(screen.getByLabelText("パスワード"), "password");
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メールアドレスを確認してください。",
    );
  });
});
