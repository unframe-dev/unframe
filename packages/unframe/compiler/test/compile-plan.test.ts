import { describe, expect, it } from "vitest";
import { createDeliveryFixtureProject } from "./fixtures/plan-project.js";
import { modelProject } from "./fixtures/model.js";
import { compileDeclarationPlan } from "../src/api/compile-plan.js";

describe("declaration compilation plan", () => {
  it("resolves a fixed declaration into render and media plans without executing a renderer", () => {
    const result = compileDeclarationPlan(createDeliveryFixtureProject(), {
      id: "baked-web",
      version: "1",
      contractVersion: "1",
      implementationHash: "sha256:test",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.definition.presentationId).toBe("compiler-wire-fixture");
    expect(Object.values(result.value.renderPlan.surfaces)).toHaveLength(1);
    expect(result.value.mediaPlan).toEqual([]);
    expect(result.value).not.toHaveProperty("renderBundle");
  });
  it("plans a model from its descriptor without materializing its bytes", () => {
    const project = modelProject();
    const result = compileDeclarationPlan(project);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.mediaPlan).toEqual([project.assets["model-source"]]);
  });

  it("rejects an invalid asset descriptor at the planning boundary", () => {
    const project = modelProject();
    const assets = {
      ...project.assets,
      "model-source": { ...project.assets["model-source"], checksum: "invalid" },
    };
    const result = compileDeclarationPlan({ ...project, assets });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("invalid descriptor was accepted");
    expect(result.diagnostics[0]?.code).toBe("compiler-invalid-asset");
  });
  it("rejects a renderer identity with accessors without evaluating them", () => {
    let reads = 0;
    const identity = Object.defineProperty(
      { id: "baked-web", version: "1", contractVersion: "1", implementationHash: "hash" },
      "implementationHash",
      {
        enumerable: true,
        get() {
          reads++;
          return "hash";
        },
      },
    );
    const result = compileDeclarationPlan(createDeliveryFixtureProject(), identity);
    expect(result.valid).toBe(false);
    expect(reads).toBe(0);
  });
});
