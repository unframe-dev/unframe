import type { PresentationDefinition, RenderBundle } from "@unframe/contracts/presentation";

import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import { hashCanonicalJsonPayload } from "../src/index.js";

export const makeM3AArtifacts = () => {
  const definition = structuredClone(definitionFixture) as unknown as PresentationDefinition;
  const bakedNode = definition.scene.nodes["node-baked"]!;
  definition.scene.nodes = { "node-baked": bakedNode };
  const surface = definition.scene.surfaces.baked!;
  definition.scene.surfaces = { baked: surface };
  if (surface.content.kind !== "structured") throw new TypeError("Expected structured fixture.");
  const root = surface.content.nodes.root;
  if (root?.kind !== "frame") throw new TypeError("Expected the v2 fixture root to be a Frame.");
  root.children = ["text"];
  delete surface.content.nodes.image;
  delete surface.content.nodes.shape;
  definition.flow.groups.intro!.steps.start!.cues = [];
  definition.flow.variables = {};

  const renderBundle = structuredClone(bundleFixture) as unknown as RenderBundle;
  const bakedBundle = renderBundle.surfaces.baked!;
  renderBundle.surfaces = { baked: bakedBundle };
  renderBundle.models = {};
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  return { definition, renderBundle };
};
