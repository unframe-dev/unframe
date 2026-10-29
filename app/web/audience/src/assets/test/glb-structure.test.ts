import { describe, expect, it } from "vitest";
import { glbStructureSchema } from "../glb-structure";

describe("GLB structural indexes", () => {
  it.each([0, Number.MAX_SAFE_INTEGER])("accepts the safe unsigned integer %s", (scene) => {
    expect(glbStructureSchema.parse({ asset: { version: "2.0" }, scene }).scene).toBe(scene);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0", null])(
    "rejects an invalid structural index %s",
    (scene) => {
      expect(glbStructureSchema.safeParse({ asset: { version: "2.0" }, scene }).success).toBe(
        false,
      );
    },
  );

  it("preserves an omitted optional index", () => {
    expect(glbStructureSchema.parse({ asset: { version: "2.0" } })).not.toHaveProperty("scene");
  });
});
