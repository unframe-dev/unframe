import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("does not register the Unity preview outside development", async () => {
  vi.stubEnv("DEV", false);
  vi.resetModules();
  const { createAppRouter } = await import("./router");
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dev/unity-preview"] }));

  render(<RouterProvider router={router} />);

  expect(await screen.findByText("ページが見つかりません")).toBeInTheDocument();
});
