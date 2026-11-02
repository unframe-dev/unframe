import { describe, expect, it } from "vitest";
import { validatePresentationDefinition } from "@unframe/presentation";
import { makeM3AArtifacts } from "./fixtures.js";

describe("Presentation public API", () => {
  it("validates a presentation through its independent public API", () => {
    const { definition } = makeM3AArtifacts();
    expect(validatePresentationDefinition(definition).valid).toBe(true);
  });

  it("rejects an invalid definition at the public boundary", () => {
    expect(validatePresentationDefinition({ schemaVersion: 1 }).valid).toBe(false);
  });
});
