import {
  defineComponentStructure,
  Frame,
  Text,
  propRef,
  namedStyleRef,
} from "@unframe/unframe-authoring";
import manifest from "./reference-badge.manifest";

const label = propRef({ propId: "label", expectedType: "string" });
const semantics = {
  rootNodeIds: ["badge-label"],
  nodes: {
    "badge-label": { id: "badge-label", parentId: null, order: 0, role: "paragraph", text: label },
  },
} as const;

export default defineComponentStructure({
  id: "reference-badge",
  componentId: manifest.componentId,
  root: (
    <Frame
      id="badge-frame"
      layout={{ kind: "absolute", x: 32, y: 264, width: 880, height: 88 }}
      style={{ backgroundColor: { red: 0.9, green: 0.93, blue: 1, alpha: 1 }, clip: true }}
    >
      <Text
        id="badge-text"
        layout={{ kind: "absolute", x: 24, y: 24, width: 832, height: 48 }}
        maxCodePoints={80}
        semanticNodeId="badge-label"
        namedStyle={namedStyleRef({ styleId: "body" })}
        style={{ fontSize: 28, lineHeight: 36 }}
      >
        {label}
      </Text>
    </Frame>
  ),
  baseSemanticTree: semantics,
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
