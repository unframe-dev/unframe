import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApplicationShell } from "./application-shell";

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/features/auth/control-plane-auth", () => ({
  controlPlaneAuth: auth,
}));

function renderShell() {
  const root = createRootRoute({ component: Outlet });
  const application = createRoute({
    component: ApplicationShell,
    getParentRoute: () => root,
    id: "application",
  });
  const home = createRoute({
    component: () => <main>ホーム</main>,
    getParentRoute: () => application,
    path: "/home",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/home"] }),
    routeTree: root.addChildren([application.addChildren([home])]),
  });
  render(<RouterProvider router={router} />);
}

describe("ApplicationShell", () => {
  it("keeps the current page when sign out returns an error", async () => {
    auth.signOut.mockResolvedValue({ error: { code: "SIGN_OUT_FAILED" } });
    renderShell();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "アカウントメニュー" }));
    await user.click(await screen.findByRole("menuitem", { name: "ログアウト" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ログアウトできませんでした。");
    expect(screen.getByRole("main")).toHaveTextContent("ホーム");
  });
});
