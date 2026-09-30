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

const layout = { height: 100, kind: "absolute", width: 200, x: 0, y: 0 } as const;
const textProps = { id: "title", layout, maxCodePoints: 40, semanticNodeId: "heading" };

describe("typed Authoring JSX", () => {
  it("produces the same nested declarations as builders", () => {
    const title = jsx(Text, { ...textProps, children: "Hello" });
    const slot = jsx(Slot, { id: "slot", slotId: "body" });
    expect(jsx(Frame, { children: [[title], [slot]], id: "root", layout })).toEqual(
      frame({
        children: [
          text({ ...textProps, value: "Hello" }),
          slotPlaceholder({ id: "slot", slotId: "body" }),
        ],
        id: "root",
        layout,
      }),
    );
  });

  it("validates JSX roots through the existing Structure boundary", () => {
    const root = jsx(Frame, { id: "root", layout });
    expect(
      defineComponentStructure({
        baseSemanticTree: { nodes: {}, rootNodeIds: [] },
        componentId: "card",
        id: "structure",
        partBindings: {},
        root,
        timelines: [],
        variantStyles: {},
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
    expect(() => jsx(Text, { ...textProps, children: "two", value: "one" })).toThrow();
    expect(() =>
      jsx(Frame, {
        get children() {
          calls++;
          return [];
        },
        id: "root",
        layout,
      }),
    ).toThrow();
    expect(() => jsx(Slot, { children: [], id: "slot", slotId: "body" })).toThrow();
    expect(() => jsx(Frame, { id: "root", kind: "text", layout })).toThrow();
    expect(calls).toBe(0);
  });
});
