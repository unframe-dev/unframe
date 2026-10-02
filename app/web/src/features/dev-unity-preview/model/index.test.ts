import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advancePreview,
  createPreviewState,
  dispatchPreviewAction,
  loadPreviewDist,
  previewActions,
  previewFrame,
} from "./index";
import { makePreviewFixture, makeTestFile, stubBrowserAssets } from "./fixture.test-helper";

afterEach(() => vi.unstubAllGlobals());

const referenceDist = resolve(process.cwd(), "../../examples/presentation/dist");

describe("preview dist", () => {
  it("requires all four build artifacts", async () => {
    await expect(loadPreviewDist([])).rejects.toThrow(/definition.json/);
  });

  it.skipIf(!existsSync(join(referenceDist, "asset-set.json")))(
    "loads the generated reference presentation dist",
    async () => {
      stubBrowserAssets();
      const assetSet = JSON.parse(readFileSync(join(referenceDist, "asset-set.json"), "utf8")) as {
        assets: Record<string, { mediaType: string }>;
      };
      const paths = [
        "definition.json",
        "render-bundle.json",
        "asset-set.json",
        "build-manifest.json",
        ...Object.entries(assetSet.assets).map(
          ([id, descriptor]) =>
            `assets/${encodeURIComponent(id)}.${descriptor.mediaType === "image/png" ? "png" : "ttf"}`,
        ),
      ];
      const files = paths.map((path) => {
        const bytes = readFileSync(join(referenceDist, path));
        return {
          name: path.split("/").at(-1)!,
          webkitRelativePath: `dist/${path}`,
          text: async () => new TextDecoder().decode(bytes),
          arrayBuffer: async () => Uint8Array.from(bytes).buffer,
        } as File;
      });

      const document = await loadPreviewDist(files);

      expect(document.artifacts.definition.presentationId).toBe("reference-presentation");
      expect(document.scene.quads.length).toBeGreaterThanOrEqual(2);
      document.dispose();
    },
  );

  it("loads a verified dist folder and releases PNG object URLs", async () => {
    stubBrowserAssets();
    const { files } = makePreviewFixture();

    const document = await loadPreviewDist(files);

    expect(document.scene.textures).toEqual([{ id: "texture", url: "blob:fixture" }]);
    expect(document.scene.quads).toHaveLength(1);
    document.dispose();
    document.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered assets and paths before creating object URLs", async () => {
    stubBrowserAssets();
    const { files } = makePreviewFixture();
    const tampered = [...files.slice(0, 4), makeTestFile("assets/texture.png", "bad"), files[5]!];

    await expect(loadPreviewDist(tampered)).rejects.toThrow(/サイズが一致しません/);
    await expect(loadPreviewDist([...files, makeTestFile("../escape", "bad")])).rejects.toThrow(
      /不正なファイルパス/,
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a same-size checksum change and an unexpected asset path", async () => {
    stubBrowserAssets();
    const { files } = makePreviewFixture();
    const original = new Uint8Array(await files[4]!.arrayBuffer());
    original[0] = original[0]! ^ 1;
    const changed = [...files];
    changed[4] = { ...files[4]!, arrayBuffer: async () => original.buffer } as File;

    await expect(loadPreviewDist(changed)).rejects.toThrow(/checksum が一致しません/);
    await expect(
      loadPreviewDist([...files, makeTestFile("assets/unexpected.png", "extra")]),
    ).rejects.toThrow(/予期しないファイル/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects artifact hash drift", async () => {
    stubBrowserAssets();
    const { files } = makePreviewFixture();
    const changed = [...files];
    changed[0] = makeTestFile("definition.json", "{}");

    await expect(loadPreviewDist(changed)).rejects.toThrow(/definition.json/);
  });

  it("projects a Timeline fade and an enabled state interaction", async () => {
    stubBrowserAssets();
    const { artifacts, files } = makePreviewFixture();
    artifacts.definition.flow.timelines["fade"] = {
      id: "fade",
      owner: { kind: "presentation" },
      durationMilliseconds: 1000,
      tracks: [
        {
          target: { nodeId: "node-baked", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
            { timeMilliseconds: 1000, value: 0.5 },
          ],
        },
        {
          target: { nodeId: "node-baked", property: "transform.position" },
          keyframes: [
            { timeMilliseconds: 0, value: [0, 0, 0], easingToNext: "linear" },
            { timeMilliseconds: 1000, value: [2, 0, 0] },
          ],
        },
      ],
    };
    artifacts.definition.flow.groups["intro"]!.steps["start"]!.cues = [
      {
        id: "play",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "timeline.play",
            timelineId: "fade",
            completion: "nonBlocking",
            conflict: "reject",
          },
        ],
        next: { kind: "stay" },
      },
    ];
    const document = await loadPreviewDist(files);
    document.artifacts.definition = artifacts.definition;
    const initial = createPreviewState(document);
    const action = previewActions(document, initial)[0]!;
    expect(action.label).toBe("next");

    const started = dispatchPreviewAction(document, initial, action.input);
    const halfway = advancePreview(document, started, 500);
    const finished = advancePreview(document, halfway, 1000);

    expect(previewFrame(document, halfway, 2).quads[0]).toMatchObject({
      visible: true,
      opacity: 0.75,
    });
    expect(previewFrame(document, finished, 3).quads[0]).toMatchObject({
      visible: true,
      opacity: 0.5,
    });
    expect(previewFrame(document, halfway, 2).nodes[0]?.position).toEqual([1, 0, 0]);
    expect(previewFrame(document, finished, 3).nodes[0]?.position).toEqual([2, 0, 0]);
    document.dispose();
  });
});
