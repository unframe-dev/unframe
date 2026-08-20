import { describe, expect, it } from "vitest";
import { migrateDocument, UnsupportedDocumentVersionError } from "./migrate-document";

describe("migrateDocument", () => {
  it("migrates a version 0 title into version 1 metadata", () => {
    const migrated = migrateDocument({
      version: 0,
      id: "legacy",
      revision: 4,
      title: "Legacy presentation",
      slides: [{ id: "slide-1", name: "Opening", elements: [] }],
      assets: [],
    });

    expect(migrated).toMatchObject({
      version: 1,
      id: "legacy",
      revision: 4,
      metadata: { title: "Legacy presentation" },
    });
  });

  it("rejects unknown future versions", () => {
    expect(() => migrateDocument({ version: 2 })).toThrow(UnsupportedDocumentVersionError);
  });
});
