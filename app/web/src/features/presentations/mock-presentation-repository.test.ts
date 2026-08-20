import { describe, expect, it } from "vitest";
import { createMockPresentation, listMockPresentations } from "./mock-presentation-repository";

describe("mock presentation repository", () => {
  it("returns presentation fixtures without sharing mutable state", async () => {
    const first = await listMockPresentations();
    const second = await listMockPresentations();

    expect(first).toHaveLength(6);
    expect(first.map((presentation) => presentation.definition.metadata.title)).toEqual([
      "Spatial product review",
      "Immersive exhibition concept",
      "Unframe demo stage",
      "Mixed reality keynote",
      "Museum wayfinding study",
      "Interactive showroom walkthrough",
    ]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first.every((presentation) => presentation.thumbnailUrl)).toBe(true);
    expect(first[0]?.thumbnailUrl).toMatch(/(?:placeholder-thumbnail\.svg|data:image\/svg\+xml)/);
  });

  it("creates a presentation resource from the starter definition", async () => {
    const presentation = await createMockPresentation("新しい空間", "アイデアの説明");

    expect(presentation.id).toMatch(/^mock-/);
    expect(presentation.revision).toBe(1);
    expect(presentation.definition.metadata).toEqual({
      title: "新しい空間",
      description: "アイデアの説明",
    });
    expect(presentation.createdAt).toBe(presentation.updatedAt);
    expect(presentation.thumbnailUrl).toMatch(
      /(?:placeholder-thumbnail\.svg|data:image\/svg\+xml)/,
    );
  });
});
