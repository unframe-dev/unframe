import {
  defineComponentStructure,
  Surface,
  Frame,
  Text,
  Slot,
  propRef,
  tokenRef,
  namedStyleRef,
  type AbsoluteLayoutDeclaration,
} from "@unframe/unframe-authoring";
import { palette, staticRenderIntent } from "./reference-values";
import manifest from "./reference-surface.manifest";

const canvas = {
  kind: "absolute",
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
} satisfies AbsoluteLayoutDeclaration;
const semantics = {
  rootNodeIds: ["heading", "summary", "detail", "continue-button"],
  nodes: {
    heading: {
      id: "heading",
      parentId: null,
      order: 0,
      role: "heading",
      level: 1,
      text: "Structured authoring",
    },
    summary: {
      id: "summary",
      parentId: null,
      order: 1,
      role: "paragraph",
      text: {
        kind: "prop-ref",
        propId: "title",
        expectedType: "string",
      },
    },
    detail: {
      id: "detail",
      parentId: null,
      order: 2,
      role: "paragraph",
      text: "Typed themes, explicit fonts, stable artifacts",
    },
    "continue-button": {
      id: "continue-button",
      parentId: null,
      order: 3,
      role: "button",
      text: "Continue",
      interactionId: "continue",
    },
  },
} as const;
const states = {
  default: {
    id: "default",
    semanticOverrides: [],
    enabledInteractionIds: ["continue"],
  },
  inactive: {
    id: "inactive",
    contentOverrides: {
      "continue-label": { kind: "text", value: "Waiting", opacity: 0.5 },
    },
    semanticOverrides: [
      {
        id: "inactive-button-label",
        kind: "semantic-override",
        targetId: "continue-button",
        text: "Waiting",
      },
    ],
    enabledInteractionIds: [],
  },
} as const;

const root = (
  <Surface
    id="reference-surface-root"
    physicalSizeMeters={[1, 0.5625]}
    logicalSize={[1920, 1080]}
    fit="contain"
    baseSemanticTree={semantics}
    interactions={{
      continue: { id: "continue", kind: "click", event: "presenter.next", hitPriority: 10 },
    }}
    initialStateId="default"
    states={states}
    renderIntent={{ ...staticRenderIntent, updateModel: "finite-state", interaction: "regions" }}
  >
    <Frame
      id="reference-frame"
      layout={canvas}
      style={{ backgroundColor: tokenRef({ category: "color", tokenId: "canvas" }) }}
    >
      <Text
        id="reference-text"
        layout={{ ...canvas, x: 64, y: 48, width: 1792, height: 104 }}
        maxCodePoints={96}
        semanticNodeId="heading"
        namedStyle={namedStyleRef({ styleId: "heading" })}
        style={{ fontSize: 64 }}
      >
        Unframe
      </Text>
      <Frame
        id="card"
        layout={{
          kind: "absolute",
          x: propRef({ propId: "offset", expectedType: "number" }),
          y: 184,
          width: 1792,
          height: 392,
        }}
        visible={propRef({ propId: "showCard", expectedType: "boolean" })}
        namedStyle={namedStyleRef({ styleId: "card" })}
      >
        <Text
          id="summary"
          layout={{ kind: "absolute", x: 32, y: 24, width: 1728, height: 64 }}
          maxCodePoints={96}
          semanticNodeId="summary"
          namedStyle={namedStyleRef({ styleId: "body" })}
        >
          {propRef({ propId: "title", expectedType: "string" })}
        </Text>
        <Frame
          id="inner"
          layout={{ kind: "absolute", x: 32, y: 112, width: 1728, height: 112 }}
          style={{
            backgroundColor: tokenRef({ category: "color", tokenId: "highlight" }),
            clip: true,
          }}
        >
          <Text
            id="detail"
            layout={{ kind: "absolute", x: 24, y: 24, width: 1680, height: 64 }}
            maxCodePoints={120}
            semanticNodeId="detail"
            namedStyle={namedStyleRef({ styleId: "body" })}
            style={{ color: palette.white }}
          >
            Typed themes, explicit fonts, stable artifacts
          </Text>
        </Frame>
        <Slot id="badge-placement" slotId="badge" />
      </Frame>
      <Text
        id="continue-label"
        layout={{ kind: "absolute", x: 128, y: 640, width: 416, height: 80 }}
        maxCodePoints={32}
        semanticNodeId="continue-button"
        namedStyle={namedStyleRef({ styleId: "body" })}
      >
        Continue
      </Text>
    </Frame>
  </Surface>
);

export default defineComponentStructure({
  id: "reference-surface",
  componentId: manifest.componentId,
  root,
  partBindings: {
    headline: "reference-text",
  },
  variantStyles: {
    tone: {
      quiet: [
        {
          targetId: "reference-text",
          targetKind: "text",
          style: {
            fontSize: 60,
          },
        },
      ],
      accent: [
        {
          targetId: "reference-text",
          targetKind: "text",
          style: {
            fontSize: 68,
            color: {
              kind: "token-ref",
              category: "color",
              tokenId: "highlight",
            },
          },
        },
      ],
    },
  },
  timelines: [],
});
