import { describe, expect, it } from "vitest";
import { migrateDocument, UnsupportedDocumentVersionError } from "./migrate-document";

describe("migrateDocument", () => {
  it("migrates a version 0 title into version 1 metadata", () => {
    const migrated = migrateDocument({
      assets: [],
      id: "legacy",
      revision: 4,
      slides: [{ elements: [], id: "slide-1", name: "Opening" }],
      title: "Legacy presentation",
      version: 0,
    });

    expect(migrated).toMatchObject({
      id: "legacy",
      metadata: { title: "Legacy presentation" },
      revision: 4,
      version: 1,
    });
  });

  it("rejects unknown future versions", () => {
    expect(() => migrateDocument({ version: 2 })).toThrow(UnsupportedDocumentVersionError);
  });
});
