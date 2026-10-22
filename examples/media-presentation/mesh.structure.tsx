import { defineComponentStructure } from "@unframe/unframe-authoring";

export default defineComponentStructure({
  id: "mesh-structure",
  componentId: "mesh",
  root: {
    kind: "model",
    id: "model-root",
    asset: {
      kind: "asset-ref",
      assetId: "mesh-source",
    },
  },
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
