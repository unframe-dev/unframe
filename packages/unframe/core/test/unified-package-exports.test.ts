import { expect, it } from "vitest";
import { hashCanonicalJsonPayload } from "@unframe/core";
import { definePresentation } from "@unframe/core/authoring";
import { standardComponents } from "@unframe/core/components";

it("exposes core and authoring APIs through one package", () => {
  expect(hashCanonicalJsonPayload({ value: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(typeof definePresentation).toBe("function");
  expect(standardComponents).toBeDefined();
});
