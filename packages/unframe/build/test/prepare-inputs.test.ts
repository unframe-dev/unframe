import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ts from "typescript";
import { createHash } from "node:crypto";
import {
  hashPackageLocator,
  hashLockedPackageContent,
  type PackageSnapshot,
} from "@unframe-dev/workspace";
import { expect, it, vi } from "vite-plus/test";
import { prepareProjectInputs } from "../src/index.js";

const found = {
  projectDirectory: "/project",
  entryFile: "main.ts",
  files: [],
  localFiles: [],
  assetSources: {},
};
const graph = { rootDependencies: [], packages: [] };
const ports = () => ({
  readTypeLibraries: vi.fn().mockResolvedValue([]),
  styles: { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() },
  modelTransformIdentity: "sha256:model" as const,
  videoTransformIdentity: vi.fn(),
});
it("prepares installed inputs without lock bytes or installing dependencies", async () => {
  const adapter = ports();
  const result = await prepareProjectInputs({ found, graph }, adapter);
  expect(result).toMatchObject({ ok: false, code: "cli-source-invalid" });
  expect(adapter.readTypeLibraries).toHaveBeenCalledOnce();
});
it("does not request environment operations after cancellation", async () => {
  const adapter = ports();
  expect(
    await prepareProjectInputs({ found, graph, signal: AbortSignal.abort() }, adapter),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
  expect(adapter.readTypeLibraries).not.toHaveBeenCalled();
});
it("reports cancellation when a type library read rejects after abort", async () => {
  const adapter = ports();
  const controller = new AbortController();
  adapter.readTypeLibraries.mockImplementation(async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  expect(
    await prepareProjectInputs({ found, graph, signal: controller.signal }, adapter),
  ).toMatchObject({ ok: false, code: "cli-cancelled" });
});

it("returns a fresh coherent input when source changes without any persistent lock", async () => {
  const first = await prepareProjectInputs(
    { found: presentationProject("First"), graph: authoringGraph() },
    {
      ...ports(),
      readTypeLibraries: async () => typeLibraries,
    },
  );
  expect(first).toMatchObject({ ok: true });
  const second = await prepareProjectInputs(
    { found: presentationProject("Second"), graph: authoringGraph() },
    {
      ...ports(),
      readTypeLibraries: async () => typeLibraries,
    },
  );
  expect(second).toMatchObject({ ok: true });
  expect(JSON.stringify(second)).toContain("Second");
  expect(JSON.stringify(first)).toContain("First");
});

function authoringGraph() {
  const data = "export const definePresentation = <T>(value: T): T => value;";
  const pkg: PackageSnapshot = {
    key: hashPackageLocator("@unframe-dev/authoring@1.0.0"),
    locator: "@unframe-dev/authoring@1.0.0",
    name: "@unframe-dev/authoring",
    version: "1.0.0",
    contentIntegrity: "sha256:unset",
    files: [
      {
        path: "index.ts",
        mediaType: "text/typescript",
        encoding: "utf8",
        data,
        hash: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      },
    ],
    exports: [{ subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" }],
    dependencies: [],
  };
  pkg.contentIntegrity = hashLockedPackageContent(pkg);
  return {
    rootDependencies: [{ specifier: pkg.name, usage: "runtime" as const, packageKey: pkg.key }],
    packages: [pkg],
  };
}
function presentationProject(title: string) {
  const text = `import {definePresentation} from "@unframe-dev/authoring";
    export default definePresentation({id:"deck",metadata:{title:${JSON.stringify(title)}},
      stage:{coordinateSystem:{unit:"meter",handedness:"right",upAxis:"+Y",forwardAxis:"-Z"},size:[1,1,1]},
      scene:{spatial:[],components:[]},assets:[],flow:{initialGroupId:"group",groups:{group:{id:"group",initialStepId:"step",steps:{step:{id:"step",cues:[]}}}},variables:{}},operations:[]});`;
  return {
    ...found,
    entryFile: "presentation.ts",
    files: [{ fileName: "presentation.ts", sourceText: text }],
    localFiles: [{ path: "presentation.ts", bytes: new TextEncoder().encode(text) }],
  };
}
const libDirectory = dirname(ts.getDefaultLibFilePath({}));
const typeLibraries = readdirSync(libDirectory)
  .filter((name) => /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u.test(name))
  .map((fileName) => ({
    fileName,
    sourceText: readFileSync(join(libDirectory, fileName), "utf8"),
  }));
it("owns source bytes before asynchronous environment reads", async () => {
  const project = presentationProject("Captured");
  const result = await prepareProjectInputs(
    { found: project, graph: authoringGraph() },
    {
      ...ports(),
      readTypeLibraries: async () => {
        project.files[0]!.sourceText = "export default (";
        project.localFiles[0]!.bytes.fill(0);
        return typeLibraries;
      },
    },
  );
  expect(result).toMatchObject({ ok: true });
  expect(JSON.stringify(result)).toContain("Captured");
});
it("rejects source text that disagrees with captured local bytes", async () => {
  const project = presentationProject("Captured");
  project.localFiles[0]!.bytes = new TextEncoder().encode("different captured source");
  const result = await prepareProjectInputs({ found: project, graph: authoringGraph() }, ports());
  expect(result).toMatchObject({ ok: false, code: "cli-source-snapshot-invalid" });
});
