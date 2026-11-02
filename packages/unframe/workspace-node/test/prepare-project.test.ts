import { expect, it, vi } from "vitest";
import { prepareProjectSource } from "../src/index.js";

it("loads TypeScript libraries and delegates Source preparation with the supplied CSS port", async () => {
  const styles = { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() };
  const found = {
    ok: true as const,
    projectDirectory: "/project",
    entryFile: "entry.tsx",
    assetSources: {},
    revision: "sha256:source",
    lockBytes: new Uint8Array(),
    files: [{ fileName: "entry.tsx", sourceText: "export default {};" }],
    localFiles: [{ path: "entry.tsx", bytes: new TextEncoder().encode("export default {};") }],
  };
  const result = await prepareProjectSource(styles, found, {
    rootDependencies: [],
    packages: [],
  });
  expect(result.source.files).toEqual(found.files);
  expect(result.source.typeLibraries.some((file) => file.fileName === "lib.d.ts")).toBe(true);
  expect(styles.compile).not.toHaveBeenCalled();
});

it("passes configured CSS inputs to the caller's style adapter", async () => {
  const snapshot = {
    version: 1 as const,
    identity: "a".repeat(64),
    sourceIdentity: "b".repeat(64),
    runtime: {
      version: "24.0.0",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      nodePath: "/node",
      nodeHash: "c".repeat(64),
      mode: "production" as const,
      closure: [],
      environment: {},
    },
    sourceFiles: [],
    rootDependencies: {},
    packages: [],
  };
  const styles = {
    snapshot: vi.fn(async () => snapshot),
    withSources: vi.fn(() => snapshot),
    compile: vi.fn(async () => ({
      ok: true as const,
      diagnostics: [],
      stylesheets: [{ entry: "style.css", css: "a{}" }],
    })),
  };
  const found = {
    ok: true as const,
    projectDirectory: "/project",
    entryFile: "entry.tsx",
    assetSources: {},
    revision: "sha256:source",
    lockBytes: new Uint8Array(),
    files: [{ fileName: "entry.tsx", sourceText: "export default {};" }],
    localFiles: [
      { path: "entry.tsx", bytes: new TextEncoder().encode("export default {};") },
      { path: "postcss.config.js", bytes: new TextEncoder().encode("export default {};") },
      { path: "style.css", bytes: new TextEncoder().encode("a{}") },
    ],
  };
  const prepared = await prepareProjectSource(
    styles,
    found,
    { rootDependencies: [], packages: [] },
    { update: true },
  );
  expect(styles.snapshot).toHaveBeenCalledWith(
    "/project",
    expect.arrayContaining([expect.objectContaining({ path: "style.css" })]),
  );
  expect(styles.compile).toHaveBeenCalledWith(snapshot, ["style.css"], undefined);
  expect(prepared.source).toMatchObject({
    preparedStyles: { stylesheets: [{ entry: "style.css", css: "a{}" }] },
  });
});
