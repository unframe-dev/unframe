import {
  defineComponentStructure,
  Frame,
  Text,
  propRef,
  namedStyleRef,
} from "@unframe/unframe-authoring";
import manifest from "./reference-badge.manifest";

const label = propRef({ expectedType: "string", propId: "label" });
const semantics = {
  nodes: {
    "badge-label": { id: "badge-label", order: 0, parentId: null, role: "paragraph", text: label },
  },
  rootNodeIds: ["badge-label"],
} as const;

export default defineComponentStructure({
  baseSemanticTree: semantics,
  componentId: manifest.componentId,
  id: "reference-badge",
  partBindings: {},
  root: (
    <Frame
      id="badge-frame"
      layout={{ height: 88, kind: "absolute", width: 880, x: 32, y: 264 }}
      style={{ backgroundColor: { alpha: 1, blue: 1, green: 0.93, red: 0.9 }, clip: true }}
    >
      <Text
        id="badge-text"
        layout={{ height: 48, kind: "absolute", width: 832, x: 24, y: 24 }}
        maxCodePoints={80}
        namedStyle={namedStyleRef({ styleId: "body" })}
        semanticNodeId="badge-label"
        style={{ fontSize: 28, lineHeight: 36 }}
      >
        {label}
      </Text>
    </Frame>
  ),
  timelines: [],
  variantStyles: {},
});
