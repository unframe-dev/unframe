import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, stringify } from "yaml";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject } from "@unframe/unframe-compiler";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { hashDependencyGraph, type UnframeLock } from "../src/filesystem/lock.js";
import { lockedFile, snapshotInstalledPackages } from "../src/filesystem/package-snapshot.js";
const repository = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const reference = join(repository, "examples/presentation");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const installFrozenGraph = async (directory: string) => {
  const documents = parseAllDocuments(await readFile(join(repository, "pnpm-lock.yaml"), "utf8"));
  const lock = documents.at(-1)?.toJS() as {
    catalogs?: unknown;
    packageExtensionsChecksum?: unknown;
    importers: Record<
      string,
      {
        dependencies: Record<string, { specifier: string; version: string }>;
        devDependencies: Record<string, { specifier: string; version: string }>;
      }
    >;
  };
  const web = lock.importers["app/web"]!;
  const runtimeNames = ["react", "react-dom"];
  const typeNames = ["@types/react", "@types/react-dom"];
  const dependencies = Object.fromEntries(
    runtimeNames.map((name) => [name, web.dependencies[name]!]),
  );
  const devDependencies = Object.fromEntries(
    typeNames.map((name) => [name, web.devDependencies[name]!]),
  );
  lock.importers = { ".": { dependencies, devDependencies } };
  const frozen = lock as typeof lock & {
    packages: Record<string, unknown>;
    snapshots: Record<string, unknown>;
  };
  const prefixes = [
    "react@",
    "react-dom@",
    "scheduler@",
    "@types/react@",
    "@types/react-dom@",
    "csstype@",
  ];
  frozen.packages = Object.fromEntries(
    Object.entries(frozen.packages).filter(([key]) =>
      prefixes.some((prefix) => key.startsWith(prefix)),
    ),
  );
  frozen.snapshots = Object.fromEntries(
    Object.entries(frozen.snapshots).filter(([key]) =>
      prefixes.some((prefix) => key.startsWith(prefix)),
    ),
  );
  delete lock.catalogs;
  delete lock.packageExtensionsChecksum;
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      name: "unframe-author-capture-fixture",
      version: "1.0.0",
      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([name, item]) => [name, item.specifier]),
      ),
      devDependencies: Object.fromEntries(
        Object.entries(devDependencies).map(([name, item]) => [name, item.specifier]),
      ),
    }),
  );
  await writeFile(join(directory, "pnpm-lock.yaml"), stringify(lock));
  const require = createRequire(join(repository, "app/web/package.json"));
  const roots = new Map<string, string>();
  for (const name of [...runtimeNames, ...typeNames])
    roots.set(name, dirname(require.resolve(`${name}/package.json`)));
  roots.set(
    "scheduler",
    dirname(require.resolve("scheduler/package.json", { paths: [roots.get("react-dom")!] })),
  );
  roots.set(
    "csstype",
    dirname(require.resolve("csstype/package.json", { paths: [roots.get("@types/react")!] })),
  );
  for (const [name, root] of roots) {
    const target = join(directory, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await cp(root, target, { recursive: true, dereference: true });
  }
  return snapshotInstalledPackages(directory);
};

export const createWebglCaptureProject = async (kind: "opaque" | "structured" = "opaque") => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-author-capture-"));
  await cp(reference, directory, { recursive: true });
  if (kind === "structured") return directory;
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const initial = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...loaded.value.virtualSource,
  });
  assert(initial.valid);
  const graph = await installFrozenGraph(directory);
  const sdkPackage = loaded.value.lock.packages.find(
    (pkg) => pkg.name === "@unframe/unframe-authoring",
  );
  assert(sdkPackage);
  const sdkEdge = loaded.value.lock.rootDependencies.find(
    (edge) => edge.specifier === "@unframe/unframe-authoring",
  );
  assert(sdkEdge);
  const next = {
    ...loaded.value.lock,
    packageManagerLockHash: graph.packageManagerLockHash,
    rootDependencies: [...graph.rootDependencies, sdkEdge].sort((a, b) =>
      compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
    ),
    packages: [...graph.packages, sdkPackage].sort((a, b) => compare(a.key, b.key)),
    assets: [],
  };
  const fresh: UnframeLock = { ...next, dependencyGraphHash: hashDependencyGraph(next) };
  await writeFile(join(directory, "unframe.lock"), canonicalizeJsonPayload(fresh) + "\n");
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const { theme: _unusedTheme, ...withoutTheme } = initial.value.presentation.value;
  const presentation = {
    ...withoutTheme,
    scene: ["hero-one", "hero-two"].map((id, index) => ({
      id,
      component: { id: "hero", version: 1 },
      props: { title: `Original ${index + 1}` },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: index === 0 ? [1.6, 1.6] : [1.6, 0.9],
      fit: "contain",
      transform: { position: [index, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    })),
    assets: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  };
  const sceneSource = presentation.scene
    .map(
      (instance) =>
        `{id: ${JSON.stringify(instance.id)}, component: Hero, props: ${JSON.stringify(instance.props)}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, physicalSizeMeters: ${JSON.stringify(instance.physicalSizeMeters)}, fit: "contain", transform: ${JSON.stringify(instance.transform)}}`,
    )
    .join(",\n");
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `import {definePresentation} from "@unframe/unframe-authoring";\nimport {Hero} from "./Hero.component";\nconst base = ${JSON.stringify(presentation)};\nexport default definePresentation({...base, scene: [${sceneSource}]});`,
  );
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe/unframe-authoring";
import "./hero.css";
export const Hero = defineComponent({
  id: "hero", version: 1,
  props: {title: editableText({required: true})},
  surface: {logicalSize: [800, 450]},
  semantics: {rootNodeIds: ["title"], nodes: {title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}}},
  render: ({texts, bindings}: {texts: {title: string}; bindings: {title: {"data-unframe-binding": string}}}) => {
    if (texts.title === "Capture failure") throw new Error("intentional capture failure");
    return <main style={{width: 800, height: 450, padding: 24, color: "#102a43", background: "linear-gradient(to right, rgba(32, 192, 96, 0.5) 75%, transparent 75%)", fontSize: 52}}><h1 {...bindings.title}>{texts.title}</h1></main>;
  },
});`,
  );
  await writeFile(
    join(directory, "hero.css"),
    `@font-face { font-family: Fixture; src: url("fixture.ttf") format("truetype"); }
main { font-family: Fixture; }
h1 { font-weight: 400; }`,
  );
  await cp(
    join(repository, "app/unity/Assets/TextMesh Pro/Fonts/LiberationSans.ttf"),
    join(directory, "fixture.ttf"),
  );
  const lock = await runPresentationCli({ args: ["lock", "refresh", directory] });
  assert.equal(lock.exitCode, 0, lock.stderr);
  const checkedFiles = await discoverPresentationProjectFiles(directory);
  assert(checkedFiles.ok);
  const checkedLock = loadUnframeLock(checkedFiles.lockBytes);
  assert(checkedLock.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: checkedFiles.entryFile,
    files: checkedFiles.files,
    rawFiles: checkedFiles.localFiles
      .filter(({ path }) => /\.(css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
    ...checkedLock.value.virtualSource,
  });
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return directory;
};
