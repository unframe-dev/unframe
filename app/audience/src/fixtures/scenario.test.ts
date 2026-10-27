import { assertViewerRuntimeCapabilities } from "../runtime/viewer-policy";
import { afterEach, expect, it, vi } from "vitest";
import { evaluateAnimationView } from "../runtime/animation-view";
import { createRuntimeStore } from "../runtime/runtime-store";
import { buildPngPlan } from "../rendering/png-plan";
import { createFixtureScenario } from "./scenario";

afterEach(() => vi.unstubAllGlobals());

it("uses checked PNG assets and applies every fixture action through the real store", async () => {
  const fetcher = vi.fn(
    async (url: URL) => new Response(new Uint8Array([1, String(url).includes("slide-a") ? 2 : 3])),
  );
  vi.stubGlobal("fetch", fetcher);
  const scenario = await createFixtureScenario("https://audience.example/");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(scenario.delivery.assetAccess!.map((asset) => asset.url)).toEqual([
    "https://audience.example/src/fixtures/slide-a.png",
    "https://audience.example/src/fixtures/slide-b.png",
  ]);
  expect(
    scenario.delivery.assetAccess!.every((asset) => /^sha256:[a-f0-9]{64}$/.test(asset.checksum!)),
  ).toBe(true);
  expect(() =>
    assertViewerRuntimeCapabilities(
      scenario.delivery.projectionProfile!.requiredRuntimeCapabilities,
    ),
  ).not.toThrow();
  const store = createRuntimeStore(scenario.delivery);
  store.applyControl({ connectionSnapshot: scenario.snapshot });
  expect(store.getSnapshot().phase).toBe("ready");
  const initial = buildPngPlan(scenario.delivery, store.getSnapshot().view);
  expect(initial.planes).toHaveLength(1);
  expect(initial.planes[0]!.width).toBe(1);
  for (const action of scenario.actions) {
    store.applyControl(action.item);
    expect(store.getSnapshot().phase, action.label).not.toBe("resync-required");
    const view = store.getSnapshot().view;
    if (view && store.getSnapshot().phase === "ready") {
      const plan = buildPngPlan(scenario.delivery, view);
      const event = action.item.reliableEvent;
      if (event?.timelineStarted) {
        const frame = evaluateAnimationView(scenario.delivery, view, 1500);
        expect(frame.view.nodeStates["intro-node"]!.opacity).toBeCloseTo(0.825);
        expect(frame.view.nodeStates["intro-node"]!.transform.position[0]).toBeCloseTo(0.15);
      }
      if (event?.surfaceTransitionStarted) {
        expect(
          evaluateAnimationView(scenario.delivery, view, 4000).surfaceTransitions,
        ).toMatchObject({ "intro-surface": { progress: 0.5 } });
      }
      if (event?.variableChanged) expect(view.variables["fixture-status"]).toBe("更新済み");
      if (event?.stepEntered) {
        expect(plan.planes.map((plane) => plane.nodeId)).toEqual(["next-node"]);
        expect(plan.assets[0]!.assetId).toBe(scenario.delivery.assetAccess![0]!.assetId);
      }
    }
  }
  expect(store.getSnapshot().phase).toBe("ended");
});

it("refuses to create a fixture when a PNG request fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  await expect(createFixtureScenario("https://audience.example/")).rejects.toThrow(
    "fixture-asset-load-failed",
  );
});
