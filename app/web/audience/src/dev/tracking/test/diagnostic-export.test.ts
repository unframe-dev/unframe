// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createDiagnostics } from "../../../tracking/diagnostics";
import { buildAnchorDiagnosticExport } from "../diagnostic-export";

it("keeps configuration failure diagnostics downloadable before an XR session exists", () => {
  const diagnostics = createDiagnostics();
  diagnostics.record(10, "display.layout", { viewportWidth: 390 });
  const result = buildAnchorDiagnosticExport({
    session: null,
    config: null,
    profile: null,
    diagnostics,
  });
  expect(result?.filename).toBe("audience-anchor-tracking-log.json");
  expect(result?.payload).toMatchObject({
    schemaVersion: 21,
    mode: "audience-anchor",
    board: null,
    profile: null,
    measurementSnapshot: null,
    anchor: { updateCount: 0, lastTagAtMs: null, sdkFromVenue: null },
    experiment: { anchorSmoothing: false, outlierWait: false },
    records: [{ timeMs: 10, event: "display.layout" }],
  });
  expect(result?.payload).not.toHaveProperty("detectorInput");
  expect(
    buildAnchorDiagnosticExport({
      session: null,
      config: null,
      profile: null,
      diagnostics,
      includeImage: true,
    }),
  ).toBeNull();
});
