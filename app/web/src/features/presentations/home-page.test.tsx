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

const { createMockPresentation, listMockPresentations } = vi.hoisted(() => ({
  createMockPresentation: vi.fn(),
  listMockPresentations: vi.fn(),
}));

vi.mock("@/features/presentations/mock-presentation-repository", () => ({
  createMockPresentation,
  listMockPresentations,
}));

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    component: HomePage,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([homeRoute]),
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

  it("shows a loading state while the presentation request is pending", async () => {
    listMockPresentations.mockImplementation(() => new Promise(() => undefined));

    renderHome();

    expect(await screen.findByRole("status")).toHaveTextContent("プレゼンテーションを読み込み中…");
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
