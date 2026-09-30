import { describe, expect, it } from "vitest";
import { demoDocument } from "@/features/editor/model/demo-document";
import type { Transform } from "@/features/editor/model/transform";
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
      elementId: "demo-model-element",
      transform,
      type: "element.transform",
    });

    expect(result.document.revision).toBe(1);
    expect(result.document.slides[0]?.elements[0]?.transform).toEqual(transform);
    expect(result.inverse).toEqual({
      elementId: "demo-model-element",
      transform: demoDocument.slides[0]?.elements[0]?.transform,
      type: "element.transform",
    });
    expect(demoDocument.revision).toBe(0);
  });

  it("restores a removed element at its original position", () => {
    const removed = applyCommand(demoDocument, {
      elementId: "demo-model-element",
      slideId: "opening",
      type: "element.remove",
    });
    const restored = applyCommand(removed.document, removed.inverse);

    expect(removed.document.slides[0]?.elements).toHaveLength(0);
    expect(restored.document.slides[0]?.elements).toEqual(demoDocument.slides[0]?.elements);
    expect(restored.document.revision).toBe(2);
  });

  it("updates only serializable element properties", () => {
    const result = applyCommand(demoDocument, {
      changes: { name: "Renamed sculpture", visible: false },
      elementId: "demo-model-element",
      type: "element.update",
    });

    expect(result.document.slides[0]?.elements[0]).toMatchObject({
      locked: false,
      name: "Renamed sculpture",
      visible: false,
    });
    expect(result.inverse).toEqual({
      changes: { name: "Unframe sculpture", visible: true },
      elementId: "demo-model-element",
      type: "element.update",
    });
  });

  it("reorders slides by ID and produces an inverse", () => {
    const result = applyCommand(demoDocument, {
      slideId: "detail",
      toIndex: 0,
      type: "slide.reorder",
    });

    expect(result.document.slides.map((slide) => slide.id)).toEqual(["detail", "opening"]);
    expect(result.inverse).toEqual({
      slideId: "detail",
      toIndex: 1,
      type: "slide.reorder",
    });
  });

  it("rejects a missing target without mutating the input", () => {
    expect(() =>
      applyCommand(demoDocument, {
        elementId: "missing",
        slideId: "opening",
        type: "element.remove",
      }),
    ).toThrow(CommandApplicationError);
    expect(demoDocument.revision).toBe(0);
    expect(demoDocument.slides[0]?.elements).toHaveLength(1);
  });

  it("keeps every command JSON serializable", () => {
    const command: EditorCommand = {
      changes: { locked: true },
      elementId: "demo-model-element",
      type: "element.update",
    };

    expect(JSON.parse(JSON.stringify(command))).toEqual(command);
  });
});
