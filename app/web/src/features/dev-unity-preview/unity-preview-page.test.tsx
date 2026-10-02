import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnityPreviewPage } from "./unity-preview-page";

const model = vi.hoisted(() => ({
  loadPreviewDist: vi.fn(),
  createPreviewState: vi.fn(() => ({
    runtimeTimeMilliseconds: 0,
    currentGroupId: "main",
    currentStepId: "start",
    ended: false,
  })),
  advancePreview: vi.fn(),
  dispatchPreviewAction: vi.fn(),
  previewActions: vi.fn(() => []),
  previewFrame: vi.fn(() => ({ nodes: [], quads: [] })),
}));
vi.mock("./model", () => model);

afterEach(() => vi.unstubAllGlobals());

describe("Unity preview page", () => {
  it("shows the Unity build after validating its HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<script>createUnityInstance(canvas, config)</script>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    render(<UnityPreviewPage />);

    expect(await screen.findByTitle("Unity プレビュー")).toHaveAttribute(
      "src",
      "/unity-preview/index.html",
    );
    expect(screen.getByLabelText("dist フォルダーを開く")).toHaveAttribute("webkitdirectory");
    expect(screen.getByRole("button", { name: "正面" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "左斜め上" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "再生" })).toBeDisabled();
  });

  it("does not embed the SPA fallback when the Unity build is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><div id='root'></div></html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    render(<UnityPreviewPage />);

    expect(await screen.findByText(/Unity ビルドがありません/)).toBeInTheDocument();
    expect(screen.queryByTitle("Unity プレビュー")).not.toBeInTheDocument();
  });

  it("reports a missing build on a 404 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    render(<UnityPreviewPage />);

    expect(await screen.findByText(/Unity ビルドがありません/)).toBeInTheDocument();
    expect(screen.queryByTitle("Unity プレビュー")).not.toBeInTheDocument();
  });

  it("reports an unexpected response type as a load failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("createUnityInstance(canvas, config)", {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    render(<UnityPreviewPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unity ビルドを読み込めませんでした",
    );
  });

  it("reports a failed build request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    render(<UnityPreviewPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unity ビルドを読み込めませんでした",
    );
    expect(screen.queryByTitle("Unity プレビュー")).not.toBeInTheDocument();
  });

  it("enables views only after the selected dist is loaded by the trusted Unity frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("createUnityInstance(canvas, config)", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const dispose = vi.fn();
    model.loadPreviewDist.mockResolvedValue({
      artifacts: { definition: { metadata: { title: "Test presentation" } } },
      scene: { nodes: [], textures: [], quads: [] },
      dispose,
    });
    const { unmount } = render(<UnityPreviewPage />);
    const frame = await screen.findByTitle<HTMLIFrameElement>("Unity プレビュー");
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.change(screen.getByLabelText("dist フォルダーを開く"), {
      target: { files: [new File(["{}"], "definition.json")] },
    });
    await screen.findByText("Test presentation");
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: window.location.origin,
          data: { source: "unframe-unity-preview", type: "ready" },
        }),
      ),
    );
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "LoadScene" }),
      expect.anything(),
    );
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: { source: "unframe-unity-preview", type: "ready" },
        }),
      ),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ method: "LoadScene" }),
        window.location.origin,
      ),
    );
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: { source: "unframe-unity-preview", type: "loaded", generation: 0 },
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "左斜め上" })).toBeDisabled();
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: { source: "unframe-unity-preview", type: "loaded", generation: 1 },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "左斜め上" }));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ method: "SetView", payload: "upper-left" }),
      window.location.origin,
    );
    expect(screen.getByLabelText("再生時間")).toHaveTextContent("0.00 s");
    let tick: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        tick = callback;
        return 1;
      }),
    );
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    model.advancePreview.mockImplementation((_document, current, time) => ({
      ...current,
      runtimeTimeMilliseconds: time,
    }));
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    act(() => tick?.(90));
    expect(screen.getByLabelText("再生時間")).toHaveTextContent("0.00 s");
    now.mockRestore();
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
