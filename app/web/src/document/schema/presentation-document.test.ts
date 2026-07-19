import { describe, expect, it } from "vitest";
import { demoDocument } from "../fixtures/demo-document";
import { PresentationDocumentSchema } from "./presentation-document";

describe("PresentationDocumentSchema", () => {
  it("accepts the version 1 demo document", () => {
    expect(PresentationDocumentSchema.parse(demoDocument)).toEqual(demoDocument);
  });

  it("requires at least one slide", () => {
    expect(() => PresentationDocumentSchema.parse({ ...demoDocument, slides: [] })).toThrow(
      /slide/i,
    );
  });

  it("rejects non-unit quaternions", () => {
    const document = structuredClone(demoDocument);
    const element = document.slides[0]?.elements[0];

    if (!element) throw new Error("demo element is missing");
    element.transform.rotation = [0, 0, 0, 2];

    expect(() => PresentationDocumentSchema.parse(document)).toThrow(/quaternion/i);
  });

  it("rejects model elements that reference missing assets", () => {
    const document = structuredClone(demoDocument);
    const element = document.slides[0]?.elements[0];

    if (!element || element.type !== "model") {
      throw new Error("demo model element is missing");
    }
    element.assetId = "missing-asset";

    expect(() => PresentationDocumentSchema.parse(document)).toThrow(/asset/i);
  });

  it("requires positive scale components", () => {
    const document = structuredClone(demoDocument);
    const element = document.slides[0]?.elements[0];

    if (!element) throw new Error("demo element is missing");
    element.transform.scale = [1, 0, 1];

    expect(() => PresentationDocumentSchema.parse(document)).toThrow(/scale/i);
  });
});
