import { describe, expect, it } from "vitest";
import { demoDocument } from "./demo-document";
import {
  deserializePresentationDocument,
  serializePresentationDocument,
} from "./presentation-document-serializer";

describe("presentation document serialization", () => {
  it("round-trips a validated document", () => {
    expect(deserializePresentationDocument(serializePresentationDocument(demoDocument))).toEqual(
      demoDocument,
    );
  });

  it("does not persist runtime-only values", () => {
    const input = {
      ...demoDocument,
      runtime: { signedUrl: "https://example.invalid/signed" },
    };

    expect(JSON.parse(serializePresentationDocument(input))).not.toHaveProperty("runtime");
  });

  it("rejects invalid JSON", () => {
    expect(() => deserializePresentationDocument("not json")).toThrow(/JSON/i);
  });
});
