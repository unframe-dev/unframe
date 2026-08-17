import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./home-page";

const { listMockPresentations, createMockPresentation } = vi.hoisted(() => ({
  listMockPresentations: vi.fn(),
  createMockPresentation: vi.fn(),
}));

vi.mock("../../features/presentations/mock-presentation-repository", () => ({
  listMockPresentations,
  createMockPresentation,
}));

function presentation(title: string, revision = 1) {
  return {
    id: `mock-${title}`,
    revision,
    definition: { metadata: { title }, groups: [] },
    createdAt: "2026-08-17T01:00:00.000Z",
    updatedAt: "2026-08-17T02:30:00.000Z",
  };
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    listMockPresentations.mockReset();
    createMockPresentation.mockReset();
  });

  it("creates a presentation from a modal", async () => {
    const user = userEvent.setup();
    listMockPresentations.mockResolvedValue([]);
    createMockPresentation.mockResolvedValue(presentation("新しい空間"));

    renderHome();
    await screen.findByText("プレゼンテーションはまだありません。");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新規作成" }));

    const dialog = screen.getByRole("dialog", { name: "プレゼンテーションを作成" });
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText("New presentation")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("タイトル"), "新しい空間");
    await user.type(screen.getByLabelText("説明（任意）"), "アイデアの説明");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    expect(await screen.findByRole("heading", { name: "新しい空間" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createMockPresentation).toHaveBeenCalledWith("新しい空間", "アイデアの説明");
  });

  it("loads presentations through the mock repository", async () => {
    listMockPresentations.mockResolvedValue([presentation("空間デザインレビュー", 3)]);

    renderHome();

    const presentationTitle = await screen.findByRole("heading", {
      level: 2,
      name: "空間デザインレビュー",
    });
    expect(presentationTitle).toBeInTheDocument();
    expect(presentationTitle.closest("li")).toHaveTextContent("更新 2026/08/17 · Revision 3");
    expect(screen.queryByRole("link", { name: "編集を開く" })).not.toBeInTheDocument();
    expect(listMockPresentations).toHaveBeenCalledOnce();
  });

  it("shows a loading state while the presentation request is pending", async () => {
    listMockPresentations.mockImplementation(() => new Promise(() => undefined));

    renderHome();

    expect(await screen.findByRole("status")).toHaveTextContent("プレゼンテーションを読み込み中…");
  });

  it("presents the workspace as one application surface", async () => {
    listMockPresentations.mockResolvedValue([]);

    renderHome();

    expect(
      await screen.findByRole("region", { name: "プレゼンテーション" }),
    ).toBeInTheDocument();
    expect(screen.getByText("00 items")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "プレゼンテーション" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("PRESENTATION WORKSPACE")).not.toBeInTheDocument();
    expect(screen.queryByText("01")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no presentations", async () => {
    const user = userEvent.setup();
    listMockPresentations.mockResolvedValue([]);

    renderHome();

    expect(await screen.findByText("プレゼンテーションはまだありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(listMockPresentations).toHaveBeenCalledTimes(2);
  });

  it("shows an error and retries the request", async () => {
    const user = userEvent.setup();
    listMockPresentations
      .mockRejectedValueOnce(new Error("Mock repository unavailable"))
      .mockResolvedValueOnce([]);

    renderHome();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プレゼンテーションを読み込めませんでした。",
    );
    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByText("プレゼンテーションはまだありません。")).toBeInTheDocument();
    expect(listMockPresentations).toHaveBeenCalledTimes(2);
  });
});
