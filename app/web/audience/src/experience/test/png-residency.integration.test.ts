import { afterEach, expect, it, vi } from "vite-plus/test";
import { Group, Texture } from "three";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe-dev/contracts/presentation";
import { createPresentationSession } from "../presentation-session";
import {
  pngDeliveryFixture,
  PNG_DEFAULT_STATE,
  PNG_INACTIVE_STATE,
} from "../../test-support/png-delivery-fixture";
import runtimeFixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { loadPngTexture } from "../../assets/png-texture";

vi.mock("../../assets/png-texture", () => ({ loadPngTexture: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function setup() {
  const delivery = structuredClone(pngDeliveryFixture.value) as DeliveryManifestWire;
  const profile = delivery.projectionProfile!;
  const nodeId = profile.runtimeCatalog!.nodes![0]!.nodeId!;
  const surfaceId = profile.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const view = participantRuntimeViewSchema.parse(runtimeFixture);
  view.projectionProfileId = profile.projectionProfileId!;
  view.nodeStates = { [nodeId]: structuredClone(view.nodeStates["node-baked"]!) };
  view.surfaceStates = { [surfaceId]: { stateId: PNG_DEFAULT_STATE } };
  view.activeRuns = [];
  view.variables = {};
  view.enabledLogicalInputs = [];
  Object.assign(delivery.residency!.textures!, {
    initialGroupId: "intro",
    groupWindows: [
      { groupId: "intro", assetIds: ["png:texture-0", "png:texture-1", "png:texture-2"] },
      { groupId: "last", assetIds: ["png:texture-0", "png:texture-1", "png:texture-3"] },
    ],
    maximumResidentGpuBytes: "16334848",
    maximumResidentTextureBindings: "3",
  });
  const created: {
    texture: Texture;
    dispose: ReturnType<typeof vi.fn>;
    releaseCpuCopy: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.mocked(loadPngTexture).mockImplementation(async () => {
    const result = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
    created.push(result);
    return result;
  });
  const contentRoot = new Group();
  const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked() {} });
  session.attachScene({ contentRoot, setPresentationOrigin() {} } as never, {
    resetState() {},
    initTexture(texture) {
      texture.onUpdate?.(texture);
    },
  });
  const next = structuredClone(view);
  next.progression.currentGroupId = "last";
  next.progression.groupEntryEpoch++;
  next.surfaceStates[surfaceId] = { stateId: PNG_INACTIVE_STATE };
  return { delivery, view, next, contentRoot, session, created };
}

it("releases retired group textures after detaching their draw references and reuses shared textures", async () => {
  const { delivery, view, next, session, contentRoot, created } = setup();
  await session.present(delivery, view);
  expect(created).toHaveLength(3);
  const root = contentRoot.children[0];
  await session.present(delivery, next);
  expect(contentRoot.children).toEqual([root]);
  expect(created).toHaveLength(4);
  expect(created[2]!.dispose).toHaveBeenCalledOnce();
  expect(created[0]!.dispose).not.toHaveBeenCalled();
  expect(created[1]!.dispose).not.toHaveBeenCalled();
  await session.present(delivery, view);
  expect(created).toHaveLength(5);
  expect(created[3]!.dispose).toHaveBeenCalledOnce();
  session.dispose();
  expect(created.every((item) => item.dispose.mock.calls.length === 1)).toBe(true);
});

it("retains the current display after a failed replacement and can retry it", async () => {
  const { delivery, view, next, session, contentRoot, created } = setup();
  await session.present(delivery, view);
  const root = contentRoot.children[0];
  vi.mocked(loadPngTexture).mockRejectedValueOnce(new Error("decode failed"));
  await expect(session.present(delivery, next)).rejects.toThrow("decode failed");
  expect(contentRoot.children).toEqual([root]);
  expect(created.every((item) => item.dispose.mock.calls.length === 0)).toBe(true);
  await session.present(delivery, next);
  expect(contentRoot.children).toEqual([root]);
  expect(created[2]!.dispose).toHaveBeenCalledOnce();
  session.dispose();
});

it("detaches the old display before loading a jump that cannot coexist within the texture budget", async () => {
  const { delivery, view, next, session, contentRoot, created } = setup();
  delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "3";
  await session.present(delivery, view);
  const previousRoot = contentRoot.children[0];
  vi.mocked(loadPngTexture).mockImplementation(async () => {
    expect(contentRoot.children).toHaveLength(0);
    const result = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
    created.push(result);
    return result;
  });
  await session.present(delivery, next);
  expect(created.slice(0, 3).every((item) => item.dispose.mock.calls.length === 1)).toBe(true);
  expect(contentRoot.children).toHaveLength(1);
  expect(contentRoot.children[0]).not.toBe(previousRoot);
  session.dispose();
});

it("discards an obsolete load without replacing the current view or reloading its shared textures", async () => {
  const { delivery, view, next, session, contentRoot, created } = setup();
  await session.present(delivery, view);
  const root = contentRoot.children[0];
  let finish!: (value: { texture: Texture; dispose(): void; releaseCpuCopy(): void }) => void;
  vi.mocked(loadPngTexture).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = session.present(delivery, next);
  const outcome = pending.catch((error: unknown) => error);
  await vi.waitFor(() => expect(loadPngTexture).toHaveBeenCalledTimes(4));
  const latest = session.present(delivery, view);
  const discarded = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
  finish(discarded);
  expect(await outcome).toBeInstanceOf(Error);
  await latest;
  expect(discarded.dispose).toHaveBeenCalledOnce();
  expect(contentRoot.children).toEqual([root]);
  expect(created.every((item) => item.dispose.mock.calls.length === 0)).toBe(true);
  expect(loadPngTexture).toHaveBeenCalledTimes(4);
  session.dispose();
});

it("can return to the previous delivery after a replacement failed following budget-driven release", async () => {
  const { delivery, view, session, contentRoot } = setup();
  delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "3";
  await session.present(delivery, view);
  const replacement = structuredClone(delivery);
  vi.mocked(loadPngTexture).mockRejectedValueOnce(new Error("request failed"));
  await expect(session.present(replacement, view)).rejects.toThrow("request failed");
  expect(contentRoot.children).toHaveLength(0);
  await session.present(delivery, view);
  expect(contentRoot.children).toHaveLength(1);
  session.dispose();
});
