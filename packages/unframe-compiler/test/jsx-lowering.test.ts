import { describe, expect, it } from "vitest";

import { lowerAuthoringDeclarationFile } from "../src/lowering/lower-authoring-declaration.js";
import { normalizeDeclarationGraph } from "../src/normalization/normalize-declaration-graph.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

const analyze = (sourceText: string) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/jsx",
    entryFile: "entry.structure.tsx",
    files: [{ fileName: "entry.structure.tsx", sourceText }],
    packageDependencies: [
      {
        packageName: "@unframe/unframe-authoring",
        packageVersion: "1",
        packageIntegrity: "integrity",
      },
    ],
    packages: [
      {
        packageName: "@unframe/unframe-authoring",
        packageVersion: "1",
        packageIntegrity: "integrity",
        files: [
          {
            fileName: "index.ts",
            sourceText: `
export const defineComponentStructure = (value: any): any => value;
export const Surface = (props: any): any => props;
export const Frame = (props: any): any => props;
export const Text = (props: any): any => props;
export const Slot = (props: any): any => props;
export const ComponentInstance = (props: any): any => props;
export const propRef = (props: any): any => props;
export const surface = (props: any): any => props;
export const frame = (props: any): any => props;
export const text = (props: any): any => props;
export const slotPlaceholder = (props: any): any => props;
export const componentInstance = (props: any): any => props;`,
          },
          {
            fileName: "jsx-runtime.ts",
            sourceText: `
export namespace JSX { export type Element = any; export type ElementType = (props: any) => any; export interface ElementChildrenAttribute { children: unknown } }
export declare const jsx: (tag: unknown, props: unknown, key?: unknown) => any;
export { jsx as jsxs };`,
          },
        ],
        exports: [
          { subpath: ".", targetFile: "index.ts" },
          { subpath: "./jsx-runtime", targetFile: "jsx-runtime.ts" },
        ],
        dependencies: [],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const result = analyzeAuthoringProject(parsed.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

describe("Authoring JSX lowering", () => {
  it("lowers verified SDK tags into the same declaration graph builders", () => {
    const analyzed = analyze(`
import { defineComponentStructure, Surface, Frame, Text, Slot } from "@unframe/unframe-authoring";
const layout = { kind: "absolute", x: 0, y: 0, width: 100, height: 40 } as const;
const label = "Hello";
const root = <Surface id="surface" physicalSizeMeters={[1, 1]} logicalSize={[100, 100]} fit="contain" baseSemanticTree={{ rootNodeIds: [], nodes: {} }} interactions={{}} initialStateId="default" states={{ default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } }} renderIntent={{ updateModel: "static", interaction: "none", internalAnimation: "none", rendererPreference: "baked-web", fallbackPolicy: "reject" }}>
  <Frame id="frame" layout={layout}>
    <Text id="text" layout={layout}>{label}</Text>
    <Slot id="slot" slotId="content" />
  </Frame>
</Surface>;
export default defineComponentStructure({ id: "structure", componentId: "component", root, partBindings: {}, variantStyles: {}, timelines: [] });`);

    const result = lowerAuthoringDeclarationFile(analyzed);
    expect(result).toMatchObject({
      ok: true,
      graph: {
        root: {
          builder: "defineComponentStructure",
          arguments: [{ kind: "object" }],
        },
      },
    });
  });

  it.each([
    ["custom component", "const Custom = Surface; const root = <Custom />;"],
    ["fragment", "const root = <><Frame /></>;"],
    ["implicit key", 'const root = <Frame key="x" />;'],
  ])("rejects %s without executing JSX runtime", (_label, declaration) => {
    const analyzed = analyze(`
import { defineComponentStructure, Surface, Frame } from "@unframe/unframe-authoring";
${declaration}
export default defineComponentStructure({ id: "s", componentId: "c", root, partBindings: {}, variantStyles: {}, timelines: [] });`);
    const result = lowerAuthoringDeclarationFile(analyzed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^compiler-static-/),
        }),
      ]),
    );
  });

  it("accepts canonical declaration values at the same JSX boundaries as the SDK", () => {
    const analyzed = analyze(`
import { defineComponentStructure, Surface, Frame, Text } from "@unframe/unframe-authoring";
const layout = { kind: "absolute", x: 0, y: 0, width: 10, height: 10 } as const;
const canonicalText = { kind: "text", id: "canonical", layout, value: "value" } as const;
const canonicalSlot = { kind: "slot-placeholder", id: "slot", slotId: "content", layout } as const;
const nested = [canonicalText, [[canonicalSlot]]] as const;
const childFrame = <Frame id="child" layout={layout}>{nested}</Frame>;
const referenced = <Text id="reference" layout={layout} value={{ kind: "prop-ref", propId: "label", expectedType: "string" }} />;
const root = <Surface id="surface">{{ kind: "frame", id: "root", layout, children: [childFrame, referenced] }}</Surface>;
export default defineComponentStructure({ id: "structure", componentId: "component", root, partBindings: {}, variantStyles: {}, timelines: [] });`);

    expect(lowerAuthoringDeclarationFile(analyzed)).toMatchObject({ ok: true });
  });

  it.each([
    ["Surface root attribute", '<Surface {...{ root: { kind: "frame" } }}><Frame /></Surface>'],
    ["Surface array child", "<Surface>{[<Frame />]}</Surface>"],
    ["Text value and empty children", '<Text value="x" children={[]} />'],
    ["Slot empty children", "<Slot children={[]} />"],
    ["ComponentInstance empty children", "<ComponentInstance children={[]} />"],
  ])("rejects %s consistently with the JSX SDK", (_label, expression) => {
    const analyzed = analyze(`
import { defineComponentStructure, Surface, Frame, Text, Slot, ComponentInstance } from "@unframe/unframe-authoring";
const root = ${expression};
export default defineComponentStructure({ id: "s", componentId: "c", root, partBindings: {}, variantStyles: {}, timelines: [] });`);

    const result = lowerAuthoringDeclarationFile(analyzed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/^compiler-static-jsx-/) }),
      ]),
    );
  });

  it("normalizes JSX and builder declarations to the same value", () => {
    const jsx = analyze(`
import { defineComponentStructure, Surface, Frame, Text } from "@unframe/unframe-authoring";
const layout = { kind: "absolute", x: 0, y: 0, width: 10, height: 10 } as const;
const root = <Surface id="surface"><Frame id="root" layout={layout}><Text id="text" layout={layout}>
  hello
  world
</Text></Frame></Surface>;
export default defineComponentStructure({ id: "s", componentId: "c", root, partBindings: {}, variantStyles: {}, timelines: [] });`);
    const builders = analyze(`
import { defineComponentStructure, surface, frame, text } from "@unframe/unframe-authoring";
const layout = { kind: "absolute", x: 0, y: 0, width: 10, height: 10 } as const;
const root = surface({ id: "surface", root: frame({ id: "root", layout, children: [text({ id: "text", layout, value: "hello world" })] }) });
export default defineComponentStructure({ id: "s", componentId: "c", root, partBindings: {}, variantStyles: {}, timelines: [] });`);
    const jsxGraph = lowerAuthoringDeclarationFile(jsx);
    const builderGraph = lowerAuthoringDeclarationFile(builders);
    expect(jsxGraph.ok).toBe(true);
    expect(builderGraph.ok).toBe(true);
    if (!jsxGraph.ok || !builderGraph.ok) return;

    const normalizedJsx = normalizeDeclarationGraph(jsxGraph.graph);
    const normalizedBuilders = normalizeDeclarationGraph(builderGraph.graph);
    expect(normalizedJsx).toMatchObject({ ok: true });
    expect(normalizedBuilders).toMatchObject({ ok: true });
    if (!normalizedJsx.ok || !normalizedBuilders.ok) return;
    expect(normalizedJsx.value).toEqual(normalizedBuilders.value);
  });
});
