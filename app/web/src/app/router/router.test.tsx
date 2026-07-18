import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
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

  it("keeps the viewer read-only on a direct route", async () => {
    await renderRoute("/editor/presentations/demo/view");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Spatial story" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("3Dプレゼンテーション")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  });
});
