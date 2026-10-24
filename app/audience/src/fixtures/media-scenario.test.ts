import { afterEach, expect, it, vi } from "vitest";
import { evaluateAnimationView } from "../runtime/animation-view";
import { createRuntimeStore } from "../runtime/runtime-store";
import { buildPngPlan } from "../rendering/png-plan";
import { buildVideoPlan } from "../rendering/video-plan";
import { buildModelPlan } from "../rendering/model-plan";
import { createMediaFixtureScenario } from "./media-scenario";

afterEach(() => vi.unstubAllGlobals());
function stubAssets() {
  const fetcher = vi.fn(
    async (url: URL) =>
      new Response(new Uint8Array(Array.from(String(url), (c) => c.charCodeAt(0)))),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it.each([false, true])(
  "applies the PNG/video/GLB fixture and all actions, late join=%s",
  async (joiningMidPlayback) => {
    const fetcher = stubAssets();
    const scenario = await createMediaFixtureScenario("https://audience.example/", {
      joiningMidPlayback,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(scenario.actions.length).toBeLessThanOrEqual(15);
    expect(
      scenario.delivery.assetAccess!.every((a) => /^sha256:[a-f0-9]{64}$/.test(a.checksum!)),
    ).toBe(true);
    const store = createRuntimeStore(scenario.delivery);
    store.applyControl({ connectionSnapshot: scenario.snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(joiningMidPlayback ? 2 : 0);
    const check = () => {
      const view = store.getSnapshot().view!;
      const evaluated = evaluateAnimationView(
        scenario.delivery,
        view,
        view.clock.runtimeTimeMilliseconds,
      );
      expect(buildPngPlan(scenario.delivery, evaluated.view).planes).toHaveLength(1);
      const video = buildVideoPlan(scenario.delivery, evaluated.view);
      expect(video.planes[0]!.width).toBeCloseTo(0.6);
      expect(video.planes[0]!.height).toBeCloseTo(0.3375);
      expect(video.assets[0]).toMatchObject({
        pixelSize: [320, 180],
        durationMilliseconds: 4000,
        audio: false,
      });
      const model = buildModelPlan(scenario.delivery, evaluated.view);
      expect(model.instances).toHaveLength(1);
      expect(model.clips.map((clip) => clip.sourceAnimationIndex)).toEqual([0, 1]);
    };
    check();
    for (const action of scenario.actions) {
      store.applyControl(action.item);
      expect(store.getSnapshot().phase, action.label).not.toBe("resync-required");
      if (store.getSnapshot().phase === "ready") check();
    }
    expect(store.getSnapshot().phase).toBe("ended");
  },
);
it("fails creation when the video request fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: URL) =>
        new Response(new Uint8Array([1]), {
          status: String(url).endsWith("motion.mp4") ? 404 : 200,
        }),
    ),
  );
  await expect(createMediaFixtureScenario("https://audience.example/")).rejects.toThrow(
    "fixture-asset-load-failed",
  );
});
