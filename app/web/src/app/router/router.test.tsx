import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers/app-providers";
import { requireSession } from "../auth/require-session";
import { createAppRouter } from "./router";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: { social: vi.fn() },
  verifyDeviceAuthorization: vi.fn(),
  device: { approve: vi.fn(), deny: vi.fn() },
}));
const product = vi.hoisted(() => ({
  presentations: { $get: vi.fn() },
}));

vi.mock("@unframe/api-client-typescript", () => ({
  createControlPlaneAuthClient: vi.fn(() => auth),
  createControlPlaneClient: vi.fn(() => product),
}));

vi.mock("../../viewer/presentation/presentation-canvas", () => ({
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
    auth.device.approve.mockReset();
    auth.device.deny.mockReset();
    product.presentations.$get.mockReset();
    product.presentations.$get.mockResolvedValue(
      new Response(JSON.stringify({ presentations: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("renders the mock-backed home route without a Presentation API request", async () => {
    await renderRoute("/home");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Presentations." }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Spatial product review" }),
    ).toBeInTheDocument();
    expect(product.presentations.$get).not.toHaveBeenCalled();

    const navigation = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    const sidebar = screen.getByRole("complementary", {
      name: "アプリケーションサイドバー",
    });
    expect(document.querySelector(".app-header")).toBeNull();
    expect(within(sidebar).getByRole("link", { name: "Unframe home" })).toBeVisible();
    expect(within(sidebar).getByRole("button", { name: "アカウントメニュー" })).toBeVisible();
    for (const label of ["ホーム", "設定", "デバイス", "ルーム"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    }
    expect(within(navigation).queryByRole("link", { name: "プロフィール" })).toBeNull();
  });

  it("switches the sidebar to settings navigation on settings pages", async () => {
    await renderRoute("/settings/profile");

    expect(
      await screen.findByRole("heading", { level: 1, name: "プロフィール" }),
    ).toBeVisible();
    const navigation = await screen.findByRole("navigation", {
      name: "設定ナビゲーション",
    });
    expect(within(navigation).getByRole("link", { name: "プロフィール" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: "セキュリティー" })).toBeVisible();
    expect(within(navigation).queryByRole("link", { name: "デバイス" })).toBeNull();
  });

  it("collapses the sidebar while keeping its links accessible", async () => {
    const user = userEvent.setup();
    await renderRoute("/home");

    const collapse = await screen.findByRole("button", {
      name: "サイドバーを折り畳む",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    await user.click(collapse);

    expect(
      screen.getByRole("button", { name: "サイドバーを展開" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("navigation", { name: "メインナビゲーション" }))
      .toBeVisible();
    expect(localStorage.getItem("unframe-sidebar-collapsed")).toBe("true");
  });

  it.each([
    ["/devices", "デバイス"],
    ["/rooms", "ルーム"],
  ])("renders the %s application route", async (path, heading) => {
    await renderRoute(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  });

  it("keeps page scrolling enabled while the account menu is open", async () => {
    const user = userEvent.setup();
    await renderRoute("/home");

    await user.click(await screen.findByRole("button", { name: "アカウントメニュー" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "設定" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "ログアウト" })).toBeVisible();
    expect(within(menu).queryByRole("menuitem", { name: "ホーム" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "プロフィール" })).toBeNull();
  });

  it("opens an editor deep link and exposes selection outside Canvas", async () => {
    const user = userEvent.setup();
    await renderRoute("/editor/demo?panel=properties");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Spatial story" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unframe sculptureを選択" }));

    expect(
      screen.getByRole("heading", {
        name: "Unframe sculpture のプロパティ",
      }),
    ).toBeInTheDocument();

    const properties = screen.getByRole("complementary", {
      name: "プロパティ",
    });
    const positionX = within(properties).getAllByRole("spinbutton", {
      name: "X",
    })[0];
    if (!positionX) throw new Error("Position X input is missing");
    await user.clear(positionX);
    await user.type(positionX, "2");
    await user.click(within(properties).getByRole("button", { name: "変形を適用" }));

    expect(screen.getByText("Revision 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeEnabled();

    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
  });

  it("renders the device authorization route and pre-fills its user code", async () => {
    await renderRoute("/device?user_code=ABCD-EFGH");

    expect(
      await screen.findByRole("heading", { name: "Connect a device." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ユーザーコード" })).toHaveValue("ABCD-EFGH");
  });

  it("redirects an unauthenticated protected route to the root", async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    await expect(requireSession()).rejects.toMatchObject({
      options: { href: "/", replace: true },
    });
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

  it("verifies and approves a pending device authorization", async () => {
    const user = userEvent.setup();
    auth.verifyDeviceAuthorization.mockResolvedValue({
      data: { user_code: "ABCD-EFGH", status: "pending" },
      error: null,
    });
    auth.device.approve.mockResolvedValue({ data: { success: true }, error: null });
    await renderRoute("/device?user_code=ABCD-EFGH");

    await user.click(await screen.findByRole("button", { name: "コードを確認" }));
    await user.click(await screen.findByRole("button", { name: "承認する" }));

    expect(auth.verifyDeviceAuthorization).toHaveBeenCalledWith("ABCD-EFGH");
    expect(auth.device.approve).toHaveBeenCalledWith({ userCode: "ABCD-EFGH" });
    expect(await screen.findByText("デバイスの接続を承認しました。")).toBeInTheDocument();
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
