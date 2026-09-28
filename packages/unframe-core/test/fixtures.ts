import type { PresentationDefinitionV2, RenderBundleV2 } from "@unframe/contracts/presentation/v2";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import { hashCanonicalJsonPayload } from "../src/index.js";

export const makeM3AArtifacts = () => {
  const definition = structuredClone(definitionFixture) as unknown as PresentationDefinitionV2;
  const bakedNode = definition.scene.nodes["node-baked"]!;
  definition.scene.nodes = { "node-baked": bakedNode };
  const surface = definition.scene.surfaces.baked!;
  definition.scene.surfaces = { baked: surface };
  const root = surface.contentNodes.root;
  if (root?.kind !== "frame") throw new TypeError("Expected the v2 fixture root to be a Frame.");
  root.children = ["text"];
  delete surface.contentNodes.image;
  delete surface.contentNodes.shape;
  definition.flow.groups.intro!.steps.start!.cues = [];
  definition.flow.variables = {};

  const renderBundle = structuredClone(bundleFixture) as unknown as RenderBundleV2;
  const bakedBundle = renderBundle.surfaces.baked!;
  renderBundle.surfaces = { baked: bakedBundle };
  renderBundle.models = {};
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  return { definition, renderBundle };
};
