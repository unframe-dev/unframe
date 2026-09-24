import { describe, expect, it } from "vitest";
import { createStarterPresentationDefinition } from "./starter-definition";

describe("createStarterPresentationDefinition", () => {
  it("creates the minimal create-contract definition", () => {
    const definition = createStarterPresentationDefinition("新規", "説明");
    expect(definition.metadata).toEqual({ title: "新規", description: "説明" });
    expect(definition.assets).toEqual([]);
    expect(definition.groups).toHaveLength(1);
  });
});
