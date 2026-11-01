import { expect, it } from "vitest";
import { loadProjectConfig } from "@unframe/workspace";

const parse = (source: string) => loadProjectConfig(new TextEncoder().encode(source));

it("registers logical asset IDs with local source paths without executing the config", () => {
  expect(
    parse(`export default {
      entryFile: "presentation.unframe.tsx",
      assets: {
        "hero-model": { path: "assets/hero.glb", mediaType: "model/gltf-binary" },
        "intro-video": { path: "assets/intro.mp4", mediaType: "video/mp4" },
        font: { path: "assets/font.ttf", mediaType: "font/ttf" },
      },
    };`),
  ).toEqual({
    entryFile: "presentation.unframe.tsx",
    assets: {
      "hero-model": { path: "assets/hero.glb", mediaType: "model/gltf-binary" },
      "intro-video": { path: "assets/intro.mp4", mediaType: "video/mp4" },
      font: { path: "assets/font.ttf", mediaType: "font/ttf" },
    },
  });
  expect(parse('export default { entryFile: "entry.tsx" };')).toEqual({
    entryFile: "entry.tsx",
    assets: {},
  });
});

it.each([
  '{ font: { path: "../font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "/font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "assets/./font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "assets\\\\font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "node_modules/font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: ".unframe/font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "assets/font.ttf", mediaType: "application/octet-stream" } }',
  '{ "bad id": { path: "assets/font.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "a.ttf", path: "b.ttf", mediaType: "font/ttf" } }',
  '{ font: { path: "a.ttf", mediaType: "font/ttf", dataBase64: "AAAA" } }',
  '{ font: { path: "a.ttf", mediaType: "font/ttf" }, font: { path: "b.ttf", mediaType: "font/ttf" } }',
  '{ font: (() => ({ path: "font.ttf", mediaType: "font/ttf" }))() }',
  '{ ...{ font: { path: "font.ttf", mediaType: "font/ttf" } } }',
  '{ get font() { throw new Error("must not execute"); } }',
  '{ ["font"]: { path: "font.ttf", mediaType: "font/ttf" } }',
])("rejects unsafe or executable source registration: %s", (assets) => {
  expect(parse(`export default { entryFile: "entry.tsx", assets: ${assets} };`)).toBeUndefined();
});
