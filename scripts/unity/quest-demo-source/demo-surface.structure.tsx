import {
  defineComponentStructure,
  Frame,
  namedStyleRef,
  Surface,
  Text,
} from "@unframe/unframe-authoring";
import manifest from "./demo-surface.manifest";

export default defineComponentStructure({
  id: "quest-demo-surface",
  componentId: manifest.componentId,
  root: (
    <Surface
      id="demo-surface"
      physicalSizeMeters={[1, 0.5625]}
      logicalSize={[512, 288]}
      fit="contain"
      baseSemanticTree={{
        rootNodeIds: ["heading", "detail", "next-button"],
        nodes: {
          heading: {
            id: "heading",
            parentId: null,
            order: 0,
            role: "heading",
            level: 1,
            text: "Quest Demo / Slide 1",
          },
          detail: {
            id: "detail",
            parentId: null,
            order: 1,
            role: "paragraph",
            text: "Create a room, then join from your phone.",
          },
          "next-button": {
            id: "next-button",
            parentId: null,
            order: 2,
            role: "button",
            text: "Next slide",
            interactionId: "next",
          },
        },
      }}
      interactions={{
        next: { id: "next", kind: "click", event: "presenter.next", hitPriority: 10 },
      }}
      initialStateId="first"
      states={{
        first: { id: "first", semanticOverrides: [], enabledInteractionIds: ["next"] },
        second: {
          id: "second",
          contentOverrides: {
            heading: { kind: "text", value: "Quest Demo / Slide 2" },
            detail: { kind: "text", value: "The same slide is shown on your phone." },
            button: { kind: "text", value: "Back to slide 1" },
          },
          semanticOverrides: [
            {
              id: "second-heading",
              kind: "semantic-override",
              targetId: "heading",
              text: "Quest Demo / Slide 2",
            },
            {
              id: "second-detail",
              kind: "semantic-override",
              targetId: "detail",
              text: "The same slide is shown on your phone.",
            },
            {
              id: "second-button",
              kind: "semantic-override",
              targetId: "next-button",
              text: "Back to slide 1",
            },
          ],
          enabledInteractionIds: ["next"],
        },
      }}
      renderIntent={{
        updateModel: "finite-state",
        interaction: "regions",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      }}
    >
      <Frame
        id="background"
        layout={{ kind: "absolute", x: 0, y: 0, width: 512, height: 288 }}
        style={{ backgroundColor: { red: 0.06, green: 0.1, blue: 0.2, alpha: 1 } }}
      >
        <Text
          id="heading"
          layout={{ kind: "absolute", x: 28, y: 36, width: 456, height: 44 }}
          maxCodePoints={64}
          semanticNodeId="heading"
          namedStyle={namedStyleRef({ styleId: "body" })}
          style={{ fontSize: 28, lineHeight: 40 }}
        >
          Quest Demo / Slide 1
        </Text>
        <Text
          id="detail"
          layout={{ kind: "absolute", x: 28, y: 102, width: 456, height: 64 }}
          maxCodePoints={80}
          semanticNodeId="detail"
          namedStyle={namedStyleRef({ styleId: "body" })}
        >
          Create a room, then join from your phone.
        </Text>
        <Frame
          id="button-background"
          layout={{ kind: "absolute", x: 28, y: 198, width: 456, height: 62 }}
          style={{ backgroundColor: { red: 0.13, green: 0.38, blue: 0.75, alpha: 1 } }}
        >
          <Text
            id="button"
            layout={{ kind: "absolute", x: 18, y: 14, width: 420, height: 32 }}
            maxCodePoints={32}
            semanticNodeId="next-button"
            namedStyle={namedStyleRef({ styleId: "body" })}
          >
            Next slide
          </Text>
        </Frame>
      </Frame>
    </Surface>
  ),
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
