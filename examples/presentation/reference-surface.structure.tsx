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
  height: 1080,
  kind: "absolute",
  width: 1920,
  x: 0,
  y: 0,
} satisfies AbsoluteLayoutDeclaration;
const semantics = {
  nodes: {
    "continue-button": {
      id: "continue-button",
      parentId: null,
      order: 3,
      role: "button",
      text: "Continue",
      interactionId: "continue",
    },
    detail: {
      id: "detail",
      parentId: null,
      order: 2,
      role: "paragraph",
      text: "Typed themes, explicit fonts, stable artifacts",
    },
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
  },
  rootNodeIds: ["heading", "summary", "detail", "continue-button"],
} as const;
const states = {
  default: {
    enabledInteractionIds: ["continue"],
    id: "default",
    semanticOverrides: [],
  },
  inactive: {
    contentOverrides: {
      "continue-label": { kind: "text", opacity: 0.5, value: "Waiting" },
    },
    enabledInteractionIds: [],
    id: "inactive",
    semanticOverrides: [
      {
        id: "inactive-button-label",
        kind: "semantic-override",
        targetId: "continue-button",
        text: "Waiting",
      },
    ],
  },
} as const;

const root = (
  <Surface
    baseSemanticTree={semantics}
    fit="contain"
    id="reference-surface-root"
    initialStateId="default"
    interactions={{
      continue: { event: "presenter.next", hitPriority: 10, id: "continue", kind: "click" },
    }}
    logicalSize={[1920, 1080]}
    physicalSizeMeters={[1, 0.5625]}
    renderIntent={{ ...staticRenderIntent, interaction: "regions", updateModel: "finite-state" }}
    states={states}
  >
    <Frame
      id="reference-frame"
      layout={canvas}
      style={{ backgroundColor: tokenRef({ category: "color", tokenId: "canvas" }) }}
    >
      <Text
        id="reference-text"
        layout={{ ...canvas, height: 104, width: 1792, x: 64, y: 48 }}
        maxCodePoints={96}
        namedStyle={namedStyleRef({ styleId: "heading" })}
        semanticNodeId="heading"
        style={{ fontSize: 64 }}
      >
        Unframe
      </Text>
      <Frame
        id="card"
        layout={{
          height: 392,
          kind: "absolute",
          width: 1792,
          x: propRef({ expectedType: "number", propId: "offset" }),
          y: 184,
        }}
        namedStyle={namedStyleRef({ styleId: "card" })}
        visible={propRef({ expectedType: "boolean", propId: "showCard" })}
      >
        <Text
          id="summary"
          layout={{ height: 64, kind: "absolute", width: 1728, x: 32, y: 24 }}
          maxCodePoints={96}
          namedStyle={namedStyleRef({ styleId: "body" })}
          semanticNodeId="summary"
        >
          {propRef({ expectedType: "string", propId: "title" })}
        </Text>
        <Frame
          id="inner"
          layout={{ height: 112, kind: "absolute", width: 1728, x: 32, y: 112 }}
          style={{
            backgroundColor: tokenRef({ category: "color", tokenId: "highlight" }),
            clip: true,
          }}
        >
          <Text
            id="detail"
            layout={{ height: 64, kind: "absolute", width: 1680, x: 24, y: 24 }}
            maxCodePoints={120}
            namedStyle={namedStyleRef({ styleId: "body" })}
            semanticNodeId="detail"
            style={{ color: palette.white }}
          >
            Typed themes, explicit fonts, stable artifacts
          </Text>
        </Frame>
        <Slot id="badge-placement" slotId="badge" />
      </Frame>
      <Text
        id="continue-label"
        layout={{ height: 80, kind: "absolute", width: 416, x: 128, y: 640 }}
        maxCodePoints={32}
        namedStyle={namedStyleRef({ styleId: "body" })}
        semanticNodeId="continue-button"
      >
        Continue
      </Text>
    </Frame>
  </Surface>
);

export default defineComponentStructure({
  componentId: manifest.componentId,
  id: "reference-surface",
  partBindings: {
    headline: "reference-text",
  },
  root,
  timelines: [
    {
      durationMilliseconds: 1000,
      id: "fade",
      tracks: [
        {
          keyframes: [
            { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
            { timeMilliseconds: 1000, value: 0.5 },
          ],
          target: { kind: "host", property: "opacity" },
        },
      ],
    },
  ],
  variantStyles: {
    tone: {
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
      quiet: [
        {
          targetId: "reference-text",
          targetKind: "text",
          style: {
            fontSize: 60,
          },
        },
      ],
    },
  },
});
