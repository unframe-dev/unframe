import {
  OpaquePreparationFailure,
  checkAuthoringProjectAssembly,
  prepareProjectInputs,
} from "@unframe-dev/build";
import { sourceAssetPorts } from "../src/application/media-ports.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";
import { copyProjectFixture } from "./copy-project-fixture.js";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterAll, afterEach, assert, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { runPresentationCli } from "../src/index.js";
import * as opaquePreparation from "../src/application/opaque-renderer.js";
import * as generationReader from "@unframe-dev/workspace-node";
import { discoverPresentationProjectFiles, readTypeLibraries } from "@unframe-dev/workspace-node";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";
import { clearSourceAssetRegistration } from "./source-asset-fixtures.js";

const temporary: string[] = [];
let reference: string;
let basePresentation: Awaited<ReturnType<typeof prepareReactProjectFixture>>["presentation"];
beforeAll(async () => {
  const fixture = await prepareReactProjectFixture();
  reference = fixture.directory;
  basePresentation = fixture.presentation;
}, 120_000);
afterAll(async () => {
  if (reference) await rm(reference, { recursive: true, force: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const component = `import {defineComponent, editableText, prop} from "@unframe-dev/authoring";
export const Hero = defineComponent({
  id: "hero", version: 1,
  props: {title: editableText({required: true})},
  surface: {logicalSize: [800, 450]},
  semantics: {rootNodeIds: ["title"], nodes: {
    title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}
  }},
  render: ({texts}: {texts: {title: string}}) => { throw texts.title; },
});`;
const createProject = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-react-"));
  temporary.push(directory);
  await copyProjectFixture(reference, directory);
  const discovery = await discoverPresentationProjectFiles(directory);
  assert(discovery.ok);
  const presentation = {
    ...basePresentation,
    scene: [],
    assets: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  };
  await clearSourceAssetRegistration(directory, discovery.entryFile);
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const source = `import {definePresentation} from "@unframe-dev/authoring";
import {Hero} from "./Hero.component";
const base = ${JSON.stringify(presentation)};
export default definePresentation({...base, scene: [{
  id: "hero-one", component: Hero, props: {title: "Hello"},
  owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"},
  physicalSizeMeters: [1.6, 0.9], fit: "contain",
  transform: {position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}
}]});`;
  await writeFile(join(directory, "presentation.unframe.tsx"), source);
  await writeFile(join(directory, "Hero.component.tsx"), component);
  return directory;
};

const inputs = async (directory: string) => {
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok);
  const result = await prepareProjectInputs(
    { found, graph: found.dependencyGraph },
    { ...sourceAssetPorts, readTypeLibraries },
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
};
describe("React installed CLI path", () => {
  it("checks a Component from an installed package export and detects changed runtime dependencies", async () => {
    const directory = await createProject();
    const entry = join(directory, "presentation.unframe.tsx");
    await writeFile(
      entry,
      (await readFile(entry, "utf8")).replace('"./Hero.component"', '"ui-kit"'),
    );
    await rm(join(directory, "Hero.component.tsx"));
    const root = join(directory, "node_modules/ui-kit");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "ui-kit",
        version: "1.0.0",
        exports: { ".": { types: "./index.d.ts", import: "./Hero.component.tsx" } },
        dependencies: { "@unframe-dev/authoring": "*" },
      }),
    );
    await writeFile(join(root, "Hero.component.tsx"), 'import "./helper.js";\n' + component);
    await writeFile(join(root, "helper.js"), 'import "./style.css";');
    await writeFile(join(root, "index.d.ts"), 'export {Hero} from "./Hero.component";');
    await writeFile(join(root, "style.css"), ".hero {color:red}");
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    manifest.dependencies["ui-kit"] = "*";
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
    const prepared = await inputs(directory);
    expect(
      prepared.assemblyCarrier.componentLocks.find((item) => item.componentId === "hero")?.origin,
    ).toMatchObject({ kind: "package", subpath: "." });
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
    await writeFile(join(root, "helper.js"), 'import "missing-package";');
    const rejected = await runPresentationCli({ args: ["check", directory] });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("compiler-frozen-input-invalid");
  }, 30000);
  it("checks without evaluating render or opening a Browser and preserves isolation requirements", async () => {
    const directory = await createProject();
    const runtime = await readFixtureGraph(
      new URL("./fixtures/react-graph.json.gz", import.meta.url),
    );
    await rm(join(directory, "node_modules"), { recursive: true });
    await installFixtureGraph(directory, runtime);
    const checked = await runPresentationCli({ args: ["check", directory] });
    expect(checked.exitCode, checked.stderr).toBe(0);
    vi.stubEnv("UNFRAME_BWRAP_PATH", "");
    vi.stubEnv("UNFRAME_OPAQUE_NODE", "");
    let opened = false;
    const built = await runPresentationCli({
      args: ["build", directory],
      host: {
        openFixedBrowser: async () => {
          opened = true;
          throw new Error("unexpected Browser");
        },
      },
    });
    expect(built.exitCode).toBe(1);
    expect(built.stderr).toContain("opaque-isolation-unavailable");
    expect(opened).toBe(false);
    await expect(readFile(join(directory, "unframe.lock"))).rejects.toThrow();
  }, 30000);
  it("retains bundle preparation diagnostics and existing dist", async () => {
    const directory = await createProject();
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist/previous.txt"), "previous");
    vi.spyOn(generationReader, "readExpectedBuildGeneration").mockResolvedValueOnce("a".repeat(32));
    vi.spyOn(opaquePreparation, "prepareOpaqueRenderer").mockRejectedValueOnce(
      new OpaquePreparationFailure([
        {
          code: "compiler-opaque-bundle-input-invalid",
          message: "Runtime dependency is missing",
          path: ["Hero.component.tsx"],
        },
      ]),
    );
    const result = await runPresentationCli({ args: ["build", directory] });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("compiler-opaque-bundle-input-invalid");
    expect(await readFile(join(directory, "dist/previous.txt"), "utf8")).toBe("previous");
  }, 30000);
  it("rejects invalid edited source without requiring a refresh", async () => {
    const directory = await createProject();
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
    await writeFile(
      join(directory, "Hero.component.tsx"),
      component.replace('id: "hero"', "id: mutate()"),
    );
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(1);
    await writeFile(join(directory, "Hero.component.tsx"), component);
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
  }, 30000);
  it("keeps semantic Instance IDs across Component relocation and Props changes", async () => {
    const directory = await createProject();
    const ids = async () => {
      const prepared = await inputs(directory);
      const checked = checkAuthoringProjectAssembly(
        prepared.source,
        prepared.assemblyCarrier,
        prepared.sourceAssetBytes,
      );
      assert(checked.valid);
      const component = prepared.assemblyCarrier.componentLocks.find(
        (item) => item.componentId === "hero",
      );
      assert(component?.mode === "opaque");
      return {
        nodes: Object.keys(checked.value.definition.scene.nodes).sort(),
        surfaces: Object.keys(checked.value.definition.scene.surfaces).sort(),
        rendererInputHash: component.rendererInputHash,
      };
    };
    const before = await ids();
    await mkdir(join(directory, "components"));
    await rename(
      join(directory, "Hero.component.tsx"),
      join(directory, "components/Hero.component.tsx"),
    );
    const entry = join(directory, "presentation.unframe.tsx");
    await writeFile(
      entry,
      (await readFile(entry, "utf8"))
        .replace("./Hero.component", "./components/Hero.component")
        .replace('title: "Hello"', 'title: "Changed"'),
    );
    expect(await ids()).toEqual(before);
  }, 30000);
  it("invalidates CSS, font and image inputs on edit and rejects external CSS references", async () => {
    const directory = await createProject();
    await writeFile(join(directory, "Hero.component.tsx"), 'import "./helper.js";\n' + component);
    await writeFile(join(directory, "helper.js"), 'import "./hero.css";');
    const css =
      '@font-face {font-family:Hero;src:url("./hero.ttf")} .hero{background:url("./hero.png")}';
    await writeFile(join(directory, "hero.css"), css);
    await writeFile(join(directory, "hero.ttf"), new Uint8Array([0, 1, 2, 3]));
    await writeFile(join(directory, "hero.png"), new Uint8Array([137, 80, 78, 71]));
    const hash = async () => {
      const prepared = await inputs(directory);
      const component = prepared.assemblyCarrier.componentLocks.find(
        (item) => item.componentId === "hero",
      );
      assert(component?.mode === "opaque");
      return component.rendererInputHash;
    };
    let previous = await hash();
    for (const [path, bytes] of [
      ["helper.js", 'import "./hero.css";\n'],
      ["hero.css", css + "\n"],
      ["hero.png", new Uint8Array([137, 80, 78, 72])],
      ["hero.ttf", new Uint8Array([0, 1, 2, 4])],
    ] as const) {
      await writeFile(join(directory, path), bytes);
      const next = await hash();
      expect(next, path).not.toBe(previous);
      previous = next;
    }
    await writeFile(
      join(directory, "hero.css"),
      '.hero{background:url("https://example.com/image.png")}',
    );
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(1);
  }, 30000);
});
