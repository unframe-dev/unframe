import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashComponentManifestDeclaration, resolvePresentation } from "@unframe-dev/compiler";
import {
  buildOpaqueComponentManifest,
  validateRuntimeReactComponent,
} from "@unframe-dev/authoring";
import { createCueState } from "@unframe-dev/playback";
import presentation from "../presentation.unframe.tsx";
import { OpeningBrand } from "../component/opening.component.tsx";
import { OriginalPanel } from "../component/original-panel.component.tsx";
import { RejectionMark } from "../component/rejection.component.tsx";
import { SpatialWord } from "../component/spatial-word.component.tsx";
import { GestureDrawing } from "../component/gesture-drawing.component.tsx";
import { TechnologyLinks } from "../component/technology-links.component.tsx";
import config from "../../unframe.config.ts";

const assets = Object.fromEntries(
  await Promise.all(
    Object.entries(config.assets).map(async ([id, asset]) => {
      const bytes = await readFile(new URL(`../../${asset.path}`, import.meta.url));
      return [
        id,
        {
          id,
          mediaType: asset.mediaType,
          encodedSizeBytes: bytes.length,
          checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
      ];
    }),
  ),
);
const components = await Promise.all(
  [
    ["src/component/opening.component.tsx", OpeningBrand],
    ["src/component/spatial-word.component.tsx", SpatialWord],
    ["src/component/technology-links.component.tsx", TechnologyLinks],
    ["src/component/gesture-drawing.component.tsx", GestureDrawing],
    ["src/component/original-panel.component.tsx", OriginalPanel],
    ["src/component/rejection.component.tsx", RejectionMark],
  ].map(async ([file, component]) => {
    const metadata = validateRuntimeReactComponent(component);
    const manifest = buildOpaqueComponentManifest(metadata, `${file}#render`);
    return {
      manifest,
      metadata,
      rendererEntry: `${file}#render`,
      rendererSource: await readFile(new URL(`../../${file}`, import.meta.url), "utf8"),
      lock: {
        mode: "opaque",
        origin: { kind: "local", entryFile: file, files: [], sourceHash: "sha256:source" },
        manifestHash: hashComponentManifestDeclaration(manifest),
        rendererInputHash: "sha256:renderer",
      },
    };
  }),
);
const resolved = resolvePresentation({
  presentation: {
    ...presentation,
    scene: presentation.scene.map((item) => {
      if (!("component" in item)) return item;
      const { component, ...rest } = item;
      return { ...rest, component: { id: component.id, version: component.version } };
    }),
  },
  themes: [],
  components,
  assets,
});
assert.ok(resolved.valid, JSON.stringify(resolved.diagnostics));
export const definition = resolved.value;
export const initialState = () =>
  createCueState(definition, 1, {
    models: Object.fromEntries(
      Object.values(definition.scene.nodes)
        .filter((n) => n.kind === "model")
        .map((n) => [n.assetId, { clips: {} }]),
    ),
  });
