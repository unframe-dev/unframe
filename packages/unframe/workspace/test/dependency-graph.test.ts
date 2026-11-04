import { createHash } from "node:crypto";
import { expect, it } from "vite-plus/test";
import {
  hashLockedPackageContent,
  hashPackageLocator,
  validateDependencyGraph,
  type PackageSnapshot,
} from "../src/index.js";

const snapshot = () => {
  const locator = "example@1.0.0#installed-instance";
  const pkg: PackageSnapshot = {
    key: hashPackageLocator(locator),
    locator,
    name: "example",
    version: "1.0.0",
    contentIntegrity: "sha256:placeholder",
    files: [
      {
        path: "index.js",
        mediaType: "text/javascript",
        encoding: "utf8",
        data: "export const value = 1;",
        hash: `sha256:${createHash("sha256").update("export const value = 1;").digest("hex")}`,
      },
    ],
    exports: [{ subpath: ".", runtimeImport: "index.js", runtimeRequire: null, types: null }],
    dependencies: [],
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  return {
    rootDependencies: [{ specifier: "example", usage: "runtime" as const, packageKey: pkg.key }],
    packages: [pkg],
  };
};
it("accepts an installed package graph without package manager metadata", () => {
  expect(validateDependencyGraph(snapshot()).packages[0]?.name).toBe("example");
});
it("rejects modified package bytes even when the graph shape remains valid", () => {
  const input = snapshot();
  input.packages[0]!.files[0]!.data = "export const value = 2;";
  expect(() => validateDependencyGraph(input)).toThrow("bytes do not match");
});
type Graph = ReturnType<typeof snapshot>;
const invalid: readonly [string, (input: Graph) => void][] = [
  [
    "integrity",
    (input) => {
      input.packages[0]!.contentIntegrity = `sha256:${"0".repeat(64)}`;
    },
  ],
  [
    "media",
    (input) => {
      input.packages[0]!.files[0]!.mediaType = "text/css";
    },
  ],
  [
    "export",
    (input) => {
      input.packages[0]!.exports[0]!.runtimeImport = "missing.js";
    },
  ],
  [
    "edge",
    (input) => {
      input.rootDependencies[0]!.packageKey = `sha256:${"0".repeat(64)}`;
    },
  ],
  [
    "key",
    (input) => {
      input.packages[0]!.key = `sha256:${"0".repeat(64)}`;
    },
  ],
  [
    "base64",
    (input) => {
      input.packages[0]!.files = [
        {
          path: "image.png",
          mediaType: "image/png",
          encoding: "base64",
          data: "not-base64",
          hash: `sha256:${"0".repeat(64)}`,
        },
      ];
    },
  ],
];
it.each(invalid)("rejects invalid %s snapshot metadata", (_reason, mutate) => {
  const input = snapshot();
  mutate(input);
  expect(() => validateDependencyGraph(input)).toThrow();
});
it("rejects packages outside the captured root dependency closure", () => {
  const graph = snapshot();
  graph.rootDependencies = [];
  expect(() => validateDependencyGraph(graph)).toThrow("reachable");
});
