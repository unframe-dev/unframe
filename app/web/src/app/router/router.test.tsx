import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers/app-providers";
import { createAppRouter } from "./router";

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
  beforeEach(() => localStorage.clear());

  it("renders the fixture-only home route", async () => {
    await renderRoute("/editor/");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "空間を、プレゼンテーションに。",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "デモを編集" })).toHaveAttribute(
      "href",
      "/editor/presentations/demo/edit?panel=properties",
    );
  });

  it("opens an editor deep link and exposes selection outside Canvas", async () => {
    const user = userEvent.setup();
    await renderRoute("/editor/presentations/demo/edit?panel=properties");

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
  });

  it("keeps the viewer read-only on a direct route", async () => {
    await renderRoute("/editor/presentations/demo/view");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Spatial story" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("3Dプレゼンテーション")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  });
});
