import { describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../api";
import { createPreviewSession } from "./preview-session";

const envelope = { requestId: "request", buildManifest: JSON.stringify({ buildId: "build" }) };
const setup = () => ({
  api: {
    build: vi.fn<EditorApi["build"]>(async () => ({
      buildId: "job",
      revision: "refreshed",
      channel: "dev" as const,
      generationId: "f".repeat(32),
      status: "succeeded" as const,
      diagnostics: [],
      artifacts: [],
    })),
    job: vi.fn(),
    cancel: vi.fn(),
    preview: vi.fn<EditorApi["preview"]>(async () => envelope),
    invalidateDisplay: vi.fn(async () => {}),
    confirmDisplay: vi.fn(async () => {}),
  },
  driver: {
    prepare: vi.fn(async () => "build"),
    commit: vi.fn(async () => "build"),
    discard: vi.fn(async () => {}),
    invalidate: vi.fn(async () => {}),
  },
  onRevision: vi.fn(),
  onInvalidated: vi.fn(),
  onLoaded: vi.fn(),
  onJob: vi.fn(),
  onError: vi.fn(),
});
describe("local Preview session", () => {
  it("awaits display invalidation before allowing an explicit replacement build", async () => {
    const input = setup();
    let finish!: () => void;
    input.api.invalidateDisplay.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const session = createPreviewSession(input);
    const invalidated = session.cancel();
    expect(invalidated).toBeInstanceOf(Promise);
    expect(input.onInvalidated).toHaveBeenCalledOnce();
    await expect.poll(() => input.api.invalidateDisplay.mock.calls.length).toBe(1);
    expect(input.driver.invalidate).not.toHaveBeenCalled();
    finish();
    await invalidated;
    expect(input.driver.invalidate).toHaveBeenCalledOnce();
  });
  it("loads Dist without building Source and confirms only a committed Unity scene", async () => {
    const input = setup();
    const session = createPreviewSession(input);
    session.request("dist", "saved");
    await expect.poll(() => input.onLoaded.mock.calls.length).toBe(1);
    expect(input.api.build).not.toHaveBeenCalled();
    expect(input.api.preview).toHaveBeenCalledWith(expect.objectContaining({ channel: "dist" }));
    expect(input.api.confirmDisplay).toHaveBeenCalledWith("request", "build");
    expect(input.driver.commit).toHaveBeenCalledWith("request");
  });
  it("uses the refreshed Dev revision and never reports prepared scenes as displayed", async () => {
    const input = setup();
    input.api.preview.mockResolvedValue({ ...envelope, sourceRevision: "refreshed" });
    let complete!: (identity: string) => void;
    input.driver.commit.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const session = createPreviewSession(input);
    session.request("dev", "saved");
    await expect.poll(() => input.driver.commit.mock.calls.length).toBe(1);
    expect(input.onRevision).toHaveBeenCalledWith("refreshed");
    expect(input.api.confirmDisplay).not.toHaveBeenCalled();
    complete("build");
    await expect.poll(() => input.onLoaded.mock.calls.length).toBe(1);
    expect(input.onLoaded).toHaveBeenCalledWith({
      mode: "dev",
      requestId: "request",
      sourceRevision: "refreshed",
      buildIdentity: "build",
    });
  });

  it("discards an old Dev preparation when mode changes to Dist", async () => {
    const input = setup();
    let finishOld!: (identity: string) => void;
    input.driver.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const session = createPreviewSession(input);
    session.request("dev", "saved");
    await expect.poll(() => input.driver.prepare.mock.calls.length).toBe(1);
    session.request("dist", "saved");
    finishOld("build");
    await expect.poll(() => input.onLoaded.mock.calls.length).toBe(1);
    expect(input.driver.discard).toHaveBeenCalledWith("request");
    expect(input.driver.commit).toHaveBeenCalledTimes(1);
    expect(input.onLoaded.mock.calls[0]?.[0].mode).toBe("dist");
    expect(input.api.confirmDisplay).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest pending Source request while a build response is outstanding", async () => {
    const input = setup();
    let finishOld!: (job: Awaited<ReturnType<typeof input.api.build>>) => void;
    input.api.build.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const session = createPreviewSession(input);
    session.request("dev", "a");
    await expect.poll(() => input.api.build.mock.calls.length).toBe(1);
    session.request("dev", "b");
    session.request("dev", "c");
    finishOld({
      buildId: "old",
      revision: "a",
      channel: "dev",
      generationId: "f".repeat(32),
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    });
    await expect.poll(() => input.onLoaded.mock.calls.length).toBe(1);
    expect(input.api.build.mock.calls.map((call) => call[0])).toEqual(["a", "c"]);
    expect(input.api.cancel).toHaveBeenCalledWith("old");
  });

  it("preserves the last successful scene and rejects a failed candidate", async () => {
    const input = setup();
    const session = createPreviewSession(input);
    session.request("dist", "saved");
    await expect.poll(() => input.onLoaded.mock.calls.length).toBe(1);
    input.driver.prepare.mockRejectedValueOnce(new Error("asset failed"));
    session.request("dist", "saved");
    await expect.poll(() => input.onError.mock.calls.length).toBe(1);
    expect(input.onLoaded).toHaveBeenCalledTimes(1);
    expect(input.driver.commit).toHaveBeenCalledTimes(1);
    expect(input.driver.discard).toHaveBeenCalledWith("request");
  });
});
