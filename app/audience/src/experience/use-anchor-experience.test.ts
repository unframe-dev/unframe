// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAnchorExperience } from "./use-anchor-experience";
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
