import { describe, expect, it, vi } from "vite-plus/test";
import { prepareProjectSource } from "../src/index.js";

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
    rootDependencies: [],
    packages: [],
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
      { replacement: "new" },
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
  it("captures changed styles on each preparation without a refresh operation", async () => {
    const styles = {
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ identity: "first", sourceIdentity: "old" })
        .mockResolvedValueOnce({ identity: "second", sourceIdentity: "new" }),
      withSources: vi.fn().mockImplementation((value) => value),
      compile: vi.fn().mockResolvedValue({ ok: true, diagnostics: [], stylesheets: [] }),
    };
    const first = await prepareProjectSource(found, graph, {}, { typeLibraries: [], styles });
    const second = await prepareProjectSource(found, graph, {}, { typeLibraries: [], styles });
    expect(first.styleSourceIdentity).toBe("old");
    expect(second.styleSourceIdentity).toBe("new");
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
      prepareProjectSource(found, graph as never, {}, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({ code: "cli-style-transform-failed", diagnostics });
    await expect(
      prepareProjectSource(found, graph as never, {}, { typeLibraries: [], styles }),
    ).rejects.toMatchObject({ code: "cli-style-worker-failed", message: "worker error" });
  });
});
