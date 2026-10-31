import { describe, expect, it } from "vitest";
import {
  Frame,
  Text,
  Slot,
  frame,
  text,
  slotPlaceholder,
  defineComponentStructure,
} from "../src/index.js";
import { jsx } from "../src/jsx-runtime.js";

const layout = { kind: "absolute", x: 0, y: 0, width: 200, height: 100 } as const;
const textProps = { id: "title", layout, maxCodePoints: 40, semanticNodeId: "heading" };

describe("typed Authoring JSX", () => {
  it("produces the same nested declarations as builders", () => {
    const title = jsx(Text, { ...textProps, children: "Hello" });
    const slot = jsx(Slot, { id: "slot", slotId: "body" });
    expect(jsx(Frame, { id: "root", layout, children: [[title], [slot]] })).toEqual(
      frame({
        id: "root",
        layout,
        children: [
          text({ ...textProps, value: "Hello" }),
          slotPlaceholder({ id: "slot", slotId: "body" }),
        ],
      }),
    );
  });

  it("validates JSX roots through the existing Structure boundary", () => {
    const root = jsx(Frame, { id: "root", layout });
    expect(
      defineComponentStructure({
        id: "structure",
        componentId: "card",
        root,
        baseSemanticTree: { rootNodeIds: [], nodes: {} },
        partBindings: {},
        variantStyles: {},
        timelines: [],
      }).root.kind,
    ).toBe("frame");
  });

  it("rejects arbitrary components, conflicting text, and accessor props without executing them", () => {
    let calls = 0;
    expect(() =>
      jsx(() => {
        calls++;
        return {};
      }, {}),
    ).toThrow();
    expect(() => jsx(Text, { ...textProps, value: "one", children: "two" })).toThrow();
    expect(() =>
      jsx(Frame, {
        id: "root",
        layout,
        get children() {
          calls++;
          return [];
        },
      }),
    ).toThrow();
    expect(() => jsx(Slot, { id: "slot", slotId: "body", children: [] })).toThrow();
    expect(() => jsx(Frame, { id: "root", layout, kind: "text" })).toThrow();
    expect(calls).toBe(0);
  });
});
