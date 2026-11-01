import { PNG_DEFAULT_STATE } from "../../test-support/png-delivery-fixture";
import { describe, expect, it } from "vitest";
import { buildVideoPlan } from "../video-plan";
import { videoFixture } from "./support/video-test-fixture";
describe("video plan", () => {
  it.each([2, 3])("rejects Delivery schema version %i", (schemaVersion) => {
    const { delivery, view } = videoFixture();
    delivery.schemaVersion = schemaVersion;
    expect(() => buildVideoPlan(delivery, view)).toThrow("projection mismatch");
  });
  it("fits a video in meters and preserves media identity", () => {
    const f = videoFixture();
    const plan = buildVideoPlan(f.delivery, f.view);
    expect(plan.planes[0]).toMatchObject({
      width: 1,
      height: 0.5625,
      assetId: JSON.stringify(["video", f.id, "video"]),
      alphaMode: "opaque",
    });
    expect(plan.assets[0]?.pixelSize).toEqual([320, 180]);
  });
  it("rejects unsupported codecs, integrity drift and decoder budgets", () => {
    const f = videoFixture();
    const artifact = f.delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.video!;
    artifact.codec = 2;
    expect(() => buildVideoPlan(f.delivery, f.view)).toThrow("H264");
    artifact.codec = 1;
    artifact.checksum = `sha256:${"2".repeat(64)}`;
    expect(() => buildVideoPlan(f.delivery, f.view)).toThrow("integrity");
    artifact.checksum = `sha256:${"1".repeat(64)}`;
    f.delivery.capabilityProfile!.limits!.video!.maxDecodedFrameBytes = "1";
    expect(() => buildVideoPlan(f.delivery, f.view)).toThrow("budget");
  });
  it("rejects ambiguous identities and non-canonical rotations", () => {
    const f = videoFixture();
    f.delivery.assetAccess!.push(structuredClone(f.delivery.assetAccess![0]!));
    expect(() => buildVideoPlan(f.delivery, f.view)).toThrow("duplicate identity");
    f.delivery.assetAccess!.pop();
    Object.values(f.view.nodeStates)[0]!.transform.rotation = [0, 0, 0, -1];
    expect(() => buildVideoPlan(f.delivery, f.view)).toThrow("non-canonical");
  });
  it("keeps independent decoders for the same source on different surfaces", () => {
    const f = videoFixture();
    const p = f.delivery.projectionProfile!;
    const n = structuredClone(p.runtimeCatalog!.nodes![0]!);
    n.nodeId = "second";
    n.surface = { semanticSurfaceId: "second" };
    p.runtimeCatalog!.nodes!.push(n);
    const s = structuredClone(p.runtimeCatalog!.surfaces![0]!);
    s.surfaceId = "second";
    s.hostNodeId = "second";
    p.runtimeCatalog!.surfaces!.push(s);
    p.renderSurfaces!.push({
      ...structuredClone(p.renderSurfaces![0]!),
      renderSurfaceId: "second",
      semanticSurfaceId: "second",
    });
    f.view.nodeStates = {
      ...f.view.nodeStates,
      second: Object.values(f.view.nodeStates)[0]!,
    } as typeof f.view.nodeStates;
    f.view.surfaceStates = {
      ...f.view.surfaceStates,
      second: { stateId: PNG_DEFAULT_STATE },
    } as typeof f.view.surfaceStates;
    expect(buildVideoPlan(f.delivery, f.view).assets.map((a) => a.assetId)).toEqual([
      JSON.stringify(["video", f.id, "video"]),
      JSON.stringify(["video", "second", "video"]),
    ]);
  });
  it("separates colon-containing decoder identities from each other and contract asset IDs", () => {
    const f = videoFixture(),
      p = f.delivery.projectionProfile!,
      catalog = p.runtimeCatalog!;
    const originalNode = catalog.nodes![0]!,
      originalSurface = catalog.surfaces![0]!,
      originalRender = p.renderSurfaces![0]!,
      originalAccess = f.delivery.assetAccess![0]!;
    if (!originalNode.surface) throw new Error("Expected surface node");
    const nodeState = Object.values(f.view.nodeStates)[0]!;
    catalog.nodes = [];
    catalog.surfaces = [];
    p.renderSurfaces = [];
    f.delivery.assetAccess = [];
    f.view.nodeStates = {} as typeof f.view.nodeStates;
    f.view.surfaceStates = {} as typeof f.view.surfaceStates;
    for (const [index, [surfaceId, sourceId]] of [
      ["a:b", "c"],
      ["a", "b:c"],
    ].entries()) {
      const nodeId = `node-${index}`;
      catalog.nodes.push({
        ...structuredClone(originalNode),
        nodeId,
        surface: { semanticSurfaceId: surfaceId! },
      });
      catalog.surfaces.push({
        ...structuredClone(originalSurface),
        surfaceId: surfaceId!,
        hostNodeId: nodeId,
      });
      const render = structuredClone(originalRender);
      render.renderSurfaceId = `render-${index}`;
      render.semanticSurfaceId = surfaceId!;
      render.artifacts![0]!.video!.videoAssetId = sourceId!;
      p.renderSurfaces.push(render);
      f.delivery.assetAccess.push({ ...structuredClone(originalAccess), assetId: sourceId! });
      f.view.nodeStates = { ...f.view.nodeStates, [nodeId]: nodeState } as typeof f.view.nodeStates;
      f.view.surfaceStates = {
        ...f.view.surfaceStates,
        [surfaceId!]: { stateId: PNG_DEFAULT_STATE },
      } as typeof f.view.surfaceStates;
    }
    f.delivery.assetAccess.push({
      ...structuredClone(originalAccess),
      assetId: "a:b:c",
      mediaType: "image/png",
    });
    const ids = buildVideoPlan(f.delivery, f.view).assets.map((a) => a.assetId);
    expect(ids).toEqual([
      JSON.stringify(["video", "a:b", "c"]),
      JSON.stringify(["video", "a", "b:c"]),
    ]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)).toBe(false);
    expect(ids).not.toContain("a:b:c");
  });
});

it.each(["delivery", "catalog"])("rejects obsolete v2 %s contracts before rendering", (kind) => {
  const { delivery, view } = videoFixture();
  if (kind === "delivery") delivery.deliveryContractVersion = 2;
  else delivery.projectionProfile!.runtimeCatalog!.catalogContractVersion = 2;
  expect(() => buildVideoPlan(delivery, view)).toThrow();
});

it("rejects frozen Anchor display state before loading media", () => {
  const { delivery, view } = videoFixture();
  expect(() =>
    buildVideoPlan(delivery, {
      ...view,
      frozenAnchors: [{ nodeId: Object.keys(view.nodeStates)[0]!, position: [1, 2, 3] }],
    }),
  ).toThrow(/Anchor/);
});
