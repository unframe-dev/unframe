import { describe, expect, it } from "vitest";
import { demoDocument } from "../../document/fixtures/demo-document";
import type { Transform } from "../../document/schema/transform";
import type { EditorCommand } from "./editor-command";
import { applyCommand, CommandApplicationError } from "./apply-command";

describe("applyCommand", () => {
  it("applies a transform atomically and creates an inverse command", () => {
    const transform: Transform = {
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const result = applyCommand(demoDocument, {
      type: "element.transform",
      elementId: "demo-model-element",
      transform,
    });

    expect(result.document.revision).toBe(1);
    expect(result.document.slides[0]?.elements[0]?.transform).toEqual(transform);
    expect(result.inverse).toEqual({
      type: "element.transform",
      elementId: "demo-model-element",
      transform: demoDocument.slides[0]?.elements[0]?.transform,
    });
    expect(demoDocument.revision).toBe(0);
  });

  it("restores a removed element at its original position", () => {
    const removed = applyCommand(demoDocument, {
      type: "element.remove",
      slideId: "opening",
      elementId: "demo-model-element",
    });
    const restored = applyCommand(removed.document, removed.inverse);

    expect(removed.document.slides[0]?.elements).toHaveLength(0);
    expect(restored.document.slides[0]?.elements).toEqual(demoDocument.slides[0]?.elements);
    expect(restored.document.revision).toBe(2);
  });

  it("updates only serializable element properties", () => {
    const result = applyCommand(demoDocument, {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { name: "Renamed sculpture", visible: false },
    });

    expect(result.document.slides[0]?.elements[0]).toMatchObject({
      name: "Renamed sculpture",
      visible: false,
      locked: false,
    });
    expect(result.inverse).toEqual({
      type: "element.update",
      elementId: "demo-model-element",
      changes: { name: "Unframe sculpture", visible: true },
    });
  });

  it("reorders slides by ID and produces an inverse", () => {
    const result = applyCommand(demoDocument, {
      type: "slide.reorder",
      slideId: "detail",
      toIndex: 0,
    });

    expect(result.document.slides.map((slide) => slide.id)).toEqual(["detail", "opening"]);
    expect(result.inverse).toEqual({
      type: "slide.reorder",
      slideId: "detail",
      toIndex: 1,
    });
  });

  it("rejects a missing target without mutating the input", () => {
    expect(() =>
      applyCommand(demoDocument, {
        type: "element.remove",
        slideId: "opening",
        elementId: "missing",
      }),
    ).toThrow(CommandApplicationError);
    expect(demoDocument.revision).toBe(0);
    expect(demoDocument.slides[0]?.elements).toHaveLength(1);
  });

  it("keeps every command JSON serializable", () => {
    const command: EditorCommand = {
      type: "element.update",
      elementId: "demo-model-element",
      changes: { locked: true },
    };

    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
  });
});
