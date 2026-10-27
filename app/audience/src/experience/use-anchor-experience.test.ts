// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAnchorExperience } from "./use-anchor-experience";
import { AnchorExperienceView } from "../AnchorExperienceView";
import { loadBoardConfig } from "../fiducials/config";
import board from "../../public/poc-config.json";

vi.mock("../fiducials/config", async (original) => ({
  ...(await original<typeof import("../fiducials/config")>()),
  loadBoardConfig: vi.fn(),
}));
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});
test.each(["tracking=1", "fixture=1"])(
  "changing marker size preserves the active %s route and replaces only size",
  async (route) => {
    vi.mocked(loadBoardConfig).mockResolvedValue(
      board as Awaited<ReturnType<typeof loadBoardConfig>>,
    );
    window.history.replaceState({}, "", `/?${route}&size=22.5&note=keep#camera`);
    const { result } = renderHook(() => useAnchorExperience());
    await waitFor(() => expect(result.current.config).not.toBeNull());
    act(() => result.current.onChangeSize("36"));
    expect(window.location.search).toBe(`?${route}&size=36&note=keep`);
    expect(window.location.hash).toBe("#camera");
    expect(result.current.profile?.markerSizeMeters).toBe(0.24);
  },
);

test("viewer uses the supplied venue dimensions and revision even when the URL requests a test size", async () => {
  const venue = { ...structuredClone(board), boardId: "conference-room", revision: 7 };
  venue.markers[0]!.sizeMeters = 0.24;
  vi.mocked(loadBoardConfig).mockResolvedValue(
    venue as Awaited<ReturnType<typeof loadBoardConfig>>,
  );
  window.history.replaceState({}, "", "/?size=70#venue");
  const { result } = renderHook(() => useAnchorExperience({ mode: "viewer" }));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  expect(result.current.config).toEqual(venue);
  expect(result.current.profile).toBeNull();
  act(() => result.current.onChangeSize("50"));
  expect(result.current.config).toEqual(venue);
  expect(window.location.search).toBe("?size=70");
  expect(window.location.hash).toBe("#venue");
  render(createElement(AnchorExperienceView, result.current));
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  expect(screen.queryByLabelText(/マーカーの外寸/)).toBeNull();
  expect(screen.queryByText("マーカーを表示・印刷")).toBeNull();
  expect(screen.getByText(/会場設定の配布元は未確定/)).toBeTruthy();
});

test("hiding guides does not switch tracking into venue configuration mode", async () => {
  vi.mocked(loadBoardConfig).mockResolvedValue(
    board as Awaited<ReturnType<typeof loadBoardConfig>>,
  );
  window.history.replaceState({}, "", "/?tracking=1&size=36");
  const { result } = renderHook(() => useAnchorExperience({ showGuides: false }));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  expect(result.current.profile?.sizeCm).toBe(36);
  expect(result.current.config?.markers[0]!.sizeMeters).toBe(0.24);
});

test("viewer ignores malformed tracking-only size queries", async () => {
  vi.mocked(loadBoardConfig).mockResolvedValue(
    board as Awaited<ReturnType<typeof loadBoardConfig>>,
  );
  window.history.replaceState({}, "", "/?size=invalid&size=70");
  const { result } = renderHook(() => useAnchorExperience({ mode: "viewer" }));
  await waitFor(() => expect(result.current.config).not.toBeNull());
  expect(result.current.error).toBeNull();
  expect(result.current.config).toEqual(board);
});
