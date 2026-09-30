import { describe, expect, it } from "vitest";
import { resolvePackageExportTargets } from "../src/filesystem/package-snapshot.js";

describe("fixed browser package export resolution", () => {
  it("preserves conditional object order and separates runtime and types", () => {
    expect(
      resolvePackageExportTargets(
        {
          exports: {
            ".": {
              browser: "./browser.js",
              import: "./esm.js",
              require: "./cjs.js",
              types: "./index.d.ts",
            },
          },
        },
        ["index.d.ts", "browser.js", "esm.js", "cjs.js"],
      ),
    ).toEqual([
      {
        runtimeImport: "browser.js",
        runtimeRequire: "browser.js",
        subpath: ".",
        types: "index.d.ts",
      },
    ]);
  });
  it("rejects missing explicit export targets", () => {
    expect(() => resolvePackageExportTargets({ exports: "./missing.js" }, [])).toThrow();
  });
  it("resolves browser object mappings to the locked browser file", () => {
    expect(
      resolvePackageExportTargets({ browser: { "./a.js": "./b.js" }, main: "./a.js" }, [
        "a.js",
        "b.js",
      ]),
    ).toEqual([{ runtimeImport: "b.js", runtimeRequire: "b.js", subpath: ".", types: null }]);
  });
  it("resolves explicit legacy root fields", () => {
    expect(
      resolvePackageExportTargets({ main: "index.js", types: "index.d.ts" }, [
        "index.js",
        "index.d.ts",
      ]),
    ).toEqual([
      { runtimeImport: "index.js", runtimeRequire: "index.js", subpath: ".", types: "index.d.ts" },
    ]);
  });
});
