import { expect, it } from "vitest";
import {
  Frame,
  Text,
  Slot,
  Surface,
  ComponentInstance,
  defineComponentStructure,
  definePresentation,
  type PresentationDeclaration,
} from "../src/index.js";

const layout = { height: 100, kind: "absolute", width: 200, x: 0, y: 0 } as const;
const semantic = {
  nodes: { heading: { id: "heading", order: 0, parentId: null, role: "paragraph", text: "Hello" } },
  rootNodeIds: ["heading"],
} as const;

it("typechecks and constructs TSX using the SDK JSX namespace", () => {
  const titles = [
    <Text id="title" layout={layout} maxCodePoints={40} semanticNodeId="heading">
      Hello
    </Text>,
  ];
  const root = (
    <Frame id="root" layout={layout}>
      {titles}
      <Slot id="slot" slotId="body" />
    </Frame>
  );
  const structure = defineComponentStructure({
    baseSemanticTree: semantic,
    componentId: "card",
    id: "structure",
    partBindings: {},
    root,
    timelines: [],
    variantStyles: {},
  });
  expect(structure.root.kind).toBe("frame");
});

// This function is typechecked without evaluating intentionally invalid declarations.
export const checkJsxTypes = (presentation: PresentationDeclaration) => {
  // @ts-expect-error Frame requires an explicit stable ID.
  const missingId = <Frame layout={layout} />;
  // @ts-expect-error Text supports typed values, not numeric content.
  const wrongText = <Text id="text" layout={layout} maxCodePoints={4} value={42} />;
  // @ts-expect-error Unknown style properties must not bypass SDK types.
  const unknownStyle = <Frame id="frame" layout={layout} style={{ color: "red" }} />;
  const slotChildren = (
    // @ts-expect-error Slot cannot accept child elements.
    <Slot id="slot" slotId="body">
      <Frame id="child" layout={layout} />
    </Slot>
  );
  const emptySurface = (
    // @ts-expect-error Surface requires a Frame child.
    <Surface
      baseSemanticTree={semantic}
      fit="contain"
      id="surface"
      initialStateId="default"
      interactions={{}}
      logicalSize={[200, 100]}
      physicalSizeMeters={[1, 1]}
      renderIntent={{
        fallbackPolicy: "reject",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        updateModel: "static",
      }}
      states={{}}
    />
  );
  const conflictingText = (
    // @ts-expect-error Text value and children are mutually exclusive.
    <Text id="text" layout={layout} maxCodePoints={4} value="one">
      two
    </Text>
  );
  const instance = (
    <ComponentInstance
      componentId="card"
      id="card"
      owner={{ kind: "presentation" }}
      partOverrides={[]}
      props={{}}
      slots={{}}
      variants={{}}
      version={1}
    />
  );
  const result: PresentationDeclaration = definePresentation({
    ...presentation,
    scene: { ...presentation.scene, components: [instance] },
  });
  return {
    conflictingText,
    emptySurface,
    missingId,
    result,
    slotChildren,
    unknownStyle,
    wrongText,
  };
};
