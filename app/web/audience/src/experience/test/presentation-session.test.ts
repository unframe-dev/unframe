import { Camera, Group } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import { createPresentation } from "../../rendering/presentation";
import { createPresentationSession } from "../presentation-session";
import { createRuntimePlayback } from "../../runtime/playback";

vi.mock("../../rendering/presentation", () => ({
  createPresentation: vi.fn(),
  hasMediaResources: (delivery: DeliveryManifestWire) =>
    !!delivery.projectionProfile?.renderSurfaces?.some((surface) => surface.rendererKind === 3),
}));
vi.mock("../../runtime/playback", () => ({ createRuntimePlayback: vi.fn() }));
const delivery = {} as DeliveryManifestWire;
const host = { presentationRoot: new Group() } as never;
function loaded() {
  return {
    root: new Group(),
    dispose: vi.fn(),
    applyView: vi.fn(() => false),
    prepareRender: vi.fn(),
    applyAnimationFrame: vi.fn(),
    setPlaybackEnabled: vi.fn(),
    resumePlayback: vi.fn(async () => {}),
    playbackBlocked: false,
    retainedCpuBytes: 4096,
  } as unknown as Awaited<ReturnType<typeof createPresentation>>;
}
function setup() {
  const renderer = { resetState: vi.fn() };
  const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked: vi.fn() });
  session.attachScene(host, renderer);
  return { renderer, session };
}
beforeEach(() => {
  vi.mocked(createPresentation).mockReset();
  vi.mocked(createRuntimePlayback).mockReset();
  vi.mocked(createRuntimePlayback).mockImplementation(
    (options) =>
      ({
        prepareFrame: vi.fn(),
        dispose: vi.fn(options.clear),
      }) as never,
  );
});
describe("presentation session resources", () => {
  it("requires an attached XR host and rejects use after disposal", async () => {
    const { session } = setup();
    session.detachScene(host);
    await expect(session.present(delivery, {})).rejects.toThrow("scene");
    session.dispose();
    expect(() => session.attachScene(host, { resetState() {} })).toThrow("disposed");
    await expect(session.present(delivery, {})).rejects.toThrow("scene");
  });
  it("keeps the old PNG while loading and accounts for its retained memory", async () => {
    const previous = loaded();
    vi.mocked(createPresentation)
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new Error("budget"));
    const { session } = setup();
    await session.present(delivery, {});
    await expect(session.present(delivery, {})).rejects.toThrow("budget");
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentCpuBytes).toBe(4096);
    expect(previous.dispose).not.toHaveBeenCalled();
    session.dispose();
    expect(previous.dispose).toHaveBeenCalledOnce();
  });
  it("resets the shared GL state before applying a view or disposing materials", async () => {
    const events: string[] = [];
    const current = loaded();
    vi.mocked(current.applyView).mockImplementation(() => {
      events.push("apply");
      return true;
    });
    vi.mocked(current.dispose).mockImplementation(() => {
      events.push("dispose");
    });
    vi.mocked(createPresentation).mockResolvedValue(current);
    const { session, renderer } = setup();
    renderer.resetState.mockImplementation(() => {
      events.push("reset");
    });
    await session.present(delivery, {});
    events.length = 0;
    await session.present(delivery, {});
    expect(events).toEqual(["reset", "apply"]);
    events.length = 0;
    session.detachScene(host);
    expect(events).toEqual(["reset", "dispose"]);
  });
  it("drains canceled work before loading a replacement in a new scene", async () => {
    const discarded = loaded();
    const next = loaded();
    let finish!: (value: typeof discarded) => void;
    vi.mocked(createPresentation)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(next);
    const { session } = setup();
    const pending = session.present(delivery, {});
    await vi.waitFor(() => expect(createPresentation).toHaveBeenCalledOnce());
    session.detachScene(host);
    expect(vi.mocked(createPresentation).mock.calls[0]![0].signal?.aborted).toBe(true);
    const nextHost = {} as never;
    session.attachScene(nextHost, { resetState() {} });
    const replacement = session.present(delivery, {});
    await Promise.resolve();
    expect(createPresentation).toHaveBeenCalledOnce();
    finish(discarded);
    await Promise.all([pending, replacement]);
    expect(discarded.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(createPresentation).mock.calls[1]![0].host).toBe(nextHost);
    session.dispose();
  });
  it("releases media resources before creating their replacement", async () => {
    const previous = loaded();
    const next = loaded();
    vi.mocked(createPresentation)
      .mockResolvedValueOnce(previous)
      .mockImplementationOnce(async () => {
        expect(previous.dispose).toHaveBeenCalledOnce();
        return next;
      });
    const { session } = setup();
    await session.present(delivery, {});
    await session.present(
      { projectionProfile: { renderSurfaces: [{ rendererKind: 3 }] } } as never,
      {},
    );
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentCpuBytes).toBe(0);
    session.dispose();
  });
  it("prepares camera-dependent ordering and exposes pause and user playback operations", async () => {
    const current = loaded();
    vi.mocked(createPresentation).mockResolvedValue(current);
    const { session } = setup();
    await session.present(delivery, {});
    const camera = new Camera();
    session.prepareRender(camera);
    expect(current.prepareRender).toHaveBeenCalledWith(camera);
    session.pause();
    expect(current.setPlaybackEnabled).toHaveBeenCalledWith(false);
    await session.resumePlayback();
    expect(current.resumePlayback).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("samples runtime frames with current playback permission and blocked state", async () => {
    let canPlay = false;
    const blocked = vi.fn();
    const session = createPresentationSession({
      canPlay: () => canPlay,
      onPlaybackBlocked: blocked,
    });
    session.attachScene(host, { resetState() {} });
    const current = loaded();
    vi.mocked(createPresentation).mockResolvedValue(current);
    const runtime = session.openRuntime(delivery);
    await session.present(delivery, {});
    const frame = vi.mocked(createRuntimePlayback).mock.calls[0]![0].frame!;
    frame({} as never, 1200);
    expect(current.setPlaybackEnabled).toHaveBeenLastCalledWith(false);
    expect(current.applyAnimationFrame).toHaveBeenCalledWith({}, 1200);
    canPlay = true;
    frame({} as never, 1400);
    expect(current.setPlaybackEnabled).toHaveBeenLastCalledWith(true);
    expect(blocked).toHaveBeenLastCalledWith(false);
    session.prepareRender(new Camera());
    expect(runtime.prepareFrame).toHaveBeenCalledOnce();
    session.detachScene(host);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("does not detach a newer scene when an old scene finishes cleanup", async () => {
    const { session } = setup();
    const nextHost = {} as never;
    session.attachScene(nextHost, { resetState() {} });
    session.detachScene(host);
    vi.mocked(createPresentation).mockResolvedValue(loaded());
    await session.present(delivery, {});
    expect(vi.mocked(createPresentation).mock.calls[0]![0].host).toBe(nextHost);
    session.dispose();
  });
});
