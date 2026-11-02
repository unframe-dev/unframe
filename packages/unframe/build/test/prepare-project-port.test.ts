import { describe, expect, it, vi } from "vitest";
import { prepareProjectSource, StylePreparationError } from "../src/index.js";

describe("source preparation style port", () => {
  const found = {
    projectDirectory: "/project",
    entryFile: "main.ts",
    files: [{ fileName: "main.ts", sourceText: "old" }],
    localFiles: [
      { path: "main.ts", bytes: new TextEncoder().encode("old") },
      { path: "postcss.config.ts", bytes: new Uint8Array() },
      { path: "main.css", bytes: new TextEncoder().encode("a{}") },
    ],
  };
  const graph = {
    rootDependencies: {},
    packages: {},
    styleTransform: null,
    styleSourceIdentity: null,
  };
  it("requests an explicit snapshot and worker and preserves the frozen identity", async () => {
    const snapshot = { identity: "identity", sourceIdentity: "source" } as never;
    const styles = {
      snapshot: vi.fn().mockResolvedValue(snapshot),
      withSources: vi.fn().mockReturnValue(snapshot),
      compile: vi.fn().mockResolvedValue({
        ok: true,
        diagnostics: [],
        stylesheets: [{ entry: "main.css", css: "a{}" }],
      }),
    };
    const result = await prepareProjectSource(
      found,
      graph as never,
      { update: true, replacement: "new" },
      { typeLibraries: [], styles },
    );
    expect(styles.snapshot).toHaveBeenCalledOnce();
    expect(styles.compile).toHaveBeenCalledWith(snapshot, ["main.css"], undefined);
    expect(result.source.files[0]?.sourceText).toBe("new");
    expect("preparedStyles" in result.source && result.source.preparedStyles.identity).toBe(
      "sha256:identity",
    );
    expect(result.styleSourceIdentity).toBe("source");
  });
  it("requires an explicit lock update before invoking the adapter", async () => {
    const styles = { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() };
    await expect(
      prepareProjectSource(found, graph as never, {}, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({
      code: "cli-style-lock-update-required",
    } satisfies Partial<StylePreparationError>);
    expect(styles.snapshot).not.toHaveBeenCalled();
  });
  it("does not call the style adapter without configuration", async () => {
    const styles = { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() };
    await prepareProjectSource(
      { ...found, localFiles: [found.localFiles[0]!] },
      graph as never,
      {},
      { typeLibraries: [], styles },
    );
    expect(styles.snapshot).not.toHaveBeenCalled();
    expect(styles.compile).not.toHaveBeenCalled();
  });
  it("rejects changed frozen sources unless refresh is explicit", async () => {
    const snapshot = { identity: "identity", sourceIdentity: "changed" } as never;
    const styles = {
      snapshot: vi.fn(),
      withSources: vi.fn().mockReturnValue(snapshot),
      compile: vi.fn().mockResolvedValue({ ok: true, diagnostics: [], stylesheets: [] }),
    };
    const locked = { ...graph, styleTransform: snapshot, styleSourceIdentity: "original" };
    await expect(
      prepareProjectSource(found, locked as never, {}, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({ code: "cli-style-source-changed" });
    expect(styles.compile).not.toHaveBeenCalled();
    await prepareProjectSource(
      found,
      locked as never,
      { refresh: true },
      { typeLibraries: [], styles },
    );
    expect(styles.compile).toHaveBeenCalledOnce();
  });
  it("preserves worker diagnostics and reports worker failures", async () => {
    const snapshot = { identity: "identity", sourceIdentity: "source" } as never;
    const diagnostics = [
      { phase: "transform", severity: "error", message: "bad css", file: "main.css" },
    ] as const;
    const styles = {
      snapshot: vi.fn().mockResolvedValue(snapshot),
      withSources: vi.fn(),
      compile: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, diagnostics })
        .mockRejectedValueOnce(new Error("worker error")),
    };
    await expect(
      prepareProjectSource(found, graph as never, { update: true }, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({ code: "cli-style-transform-failed", diagnostics });
    await expect(
      prepareProjectSource(found, graph as never, { update: true }, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({ code: "cli-style-worker-failed", message: "worker error" });
  });
});
