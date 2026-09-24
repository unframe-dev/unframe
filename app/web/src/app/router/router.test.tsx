import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers/app-providers";
import { requireSession } from "@/features/auth/require-session";
import { createAppRouter } from "./router";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: { social: vi.fn() },
  verifyDeviceAuthorization: vi.fn(),
  device: { deny: vi.fn() },
}));
vi.mock("@unframe/api-client-typescript", () => ({
  createControlPlaneAuthClient: vi.fn(() => auth),
}));

vi.mock("@/features/editor/ui/presentation-canvas", () => ({
  PresentationCanvas: () => <div aria-label="3Dプレゼンテーション">3D viewport</div>,
}));

async function renderRoute(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));

  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe("web editor routes", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.getSession.mockResolvedValue({ data: { user: { name: "テストユーザー" } }, error: null });
    auth.signIn.social.mockReset();
    auth.verifyDeviceAuthorization.mockReset();
    auth.device.deny.mockReset();
  });

  it("redirects an unauthenticated protected route to the root", async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    await expect(requireSession()).rejects.toMatchObject({
      options: { href: "/", replace: true },
    });
  });

  it("redirects an unauthenticated editor route to the root", async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    const router = await renderRoute("/editor/demo?panel=properties");

    await router.load();
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps the device URL and code in the Google sign-in callback", async () => {
    const user = userEvent.setup();
    auth.getSession.mockResolvedValue({ data: null, error: null });
    await renderRoute("/device?user_code=ABCD-EFGH");

    await user.click(await screen.findByRole("button", { name: "Google でログイン" }));

    expect(auth.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/device?user_code=ABCD-EFGH`,
    });
  });

  it("shows a recoverable error when the session check fails", async () => {
    auth.getSession.mockRejectedValue(new Error("network unavailable"));
    await renderRoute("/device?user_code=ABCD-EFGH");

    expect(
      await screen.findByText("処理中に問題が発生しました。時間をおいてもう一度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログイン状態を再確認" })).toBeEnabled();
  });

  it("shows a safe error when Google sign-in returns an API error", async () => {
    const user = userEvent.setup();
    auth.getSession.mockResolvedValue({ data: null, error: null });
    auth.signIn.social.mockResolvedValue({ data: null, error: { error: "request_failed" } });
    await renderRoute("/device?user_code=ABCD-EFGH");

    await user.click(await screen.findByRole("button", { name: "Google でログイン" }));

    expect(
      await screen.findByText("処理中に問題が発生しました。時間をおいてもう一度お試しください。"),
    ).toBeInTheDocument();
  });

  it("can deny a pending authorization and prevents double submission while loading", async () => {
    const user = userEvent.setup();
    auth.verifyDeviceAuthorization.mockResolvedValue({
      data: { user_code: "ABCD-EFGH", status: "pending" },
      error: null,
    });
    let resolveDeny: (value: { data: { success: boolean }; error: null }) => void;
    auth.device.deny.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeny = resolve;
        }),
    );
    await renderRoute("/device?user_code=ABCD-EFGH");

    await user.click(await screen.findByRole("button", { name: "コードを確認" }));
    const deny = await screen.findByRole("button", { name: "拒否する" });
    await user.click(deny);
    expect(deny).toBeDisabled();
    expect(screen.getByRole("button", { name: "承認する" })).toBeDisabled();
    resolveDeny!({ data: { success: true }, error: null });

    expect(await screen.findByText("デバイスの接続を拒否しました。")).toBeInTheDocument();
  });

  it("shows a safe error when device verification fails", async () => {
    const user = userEvent.setup();
    auth.verifyDeviceAuthorization.mockResolvedValue({
      data: null,
      error: { error: "expired_token" },
    });
    await renderRoute("/device?user_code=ABCD-EFGH");

    await user.click(await screen.findByRole("button", { name: "コードを確認" }));

    expect(await screen.findByText("このコードの有効期限が切れています。")).toBeInTheDocument();
  });
});
