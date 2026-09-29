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

const layout = { kind: "absolute", x: 0, y: 0, width: 200, height: 100 } as const;
const semantic = {
  rootNodeIds: ["heading"],
  nodes: { heading: { id: "heading", parentId: null, order: 0, role: "paragraph", text: "Hello" } },
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
    id: "structure",
    componentId: "card",
    root,
    baseSemanticTree: semantic,
    partBindings: {},
    variantStyles: {},
    timelines: [],
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
      id="surface"
      physicalSizeMeters={[1, 1]}
      logicalSize={[200, 100]}
      fit="contain"
      baseSemanticTree={semantic}
      interactions={{}}
      states={{}}
      initialStateId="default"
      renderIntent={{
        updateModel: "static",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      }}
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
      id="card"
      componentId="card"
      version={1}
      owner={{ kind: "presentation" }}
      packageLock={{
        packageVersion: "1",
        packageIntegrity: "sha256:test",
        manifestHash: "sha256:manifest",
        structureHash: "sha256:structure",
      }}
      props={{}}
      slots={{}}
      variants={{}}
      partOverrides={[]}
    />
  );
  const result: PresentationDeclaration = definePresentation({
    ...presentation,
    scene: { ...presentation.scene, components: [instance] },
  });
  return {
    missingId,
    wrongText,
    unknownStyle,
    slotChildren,
    emptySurface,
    conflictingText,
    result,
  };
};
