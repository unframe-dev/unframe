import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, stringify } from "yaml";
import { afterEach, assert, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject } from "@unframe/unframe-compiler";

import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { hashDependencyGraph, type UnframeLockV2 } from "../src/filesystem/lock-v2.js";
import { lockedFile, snapshotInstalledPackages } from "../src/filesystem/package-snapshot.js";

const execute = promisify(execFile);
const repository = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const reference = join(repository, "examples/presentation");
const temporary: string[] = [];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fromReference = async (directory: string) => {
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...loaded.value.virtualSource,
  });
  assert(checked.valid);
  return { loaded: loaded.value.lock, presentation: checked.value.presentation.value };
};

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
  const runtimeNames = ["@base-ui/react", "react", "react-dom"];
  const typeNames = ["@types/react", "@types/react-dom"];
  const dependencies = Object.fromEntries(
    runtimeNames.map((name) => [name, web.dependencies[name]!]),
  );
  const devDependencies = Object.fromEntries(
    typeNames.map((name) => [name, web.devDependencies[name]!]),
  );
  lock.importers = { ".": { dependencies, devDependencies } };
  delete lock.catalogs;
  delete lock.packageExtensionsChecksum;
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      name: "unframe-opaque-fixture",
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
  await execute(
    "pnpm",
    ["install", "--frozen-lockfile", "--offline", "--ignore-scripts", "--ignore-pnpmfile"],
    { cwd: directory, timeout: 120_000 },
  ).catch((error: Error & { stderr?: string; stdout?: string }) => {
    throw new Error(`${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message}`);
  });
  return snapshotInstalledPackages(directory);
};

const createProject = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-opaque-integration-"));
  temporary.push(directory);
  await cp(reference, directory, { recursive: true });
  const { loaded, presentation: initial } = await fromReference(directory);
  const graph = await installFrozenGraph(directory);
  const sdkPackage = loaded.packages.find((pkg) => pkg.name === "@unframe/unframe-authoring");
  assert(sdkPackage);
  const sdkEdge = loaded.rootDependencies.find(
    (edge) => edge.specifier === "@unframe/unframe-authoring",
  );
  assert(sdkEdge);
  const next = {
    ...loaded,
    packageManagerLockHash: graph.packageManagerLockHash,
    rootDependencies: [...graph.rootDependencies, sdkEdge].sort((a, b) =>
      compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
    ),
    packages: [...graph.packages, sdkPackage].sort((a, b) => compare(a.key, b.key)),
    assets: [],
  };
  const fresh: UnframeLockV2 = { ...next, dependencyGraphHash: hashDependencyGraph(next) };
  await writeFile(join(directory, "unframe.lock"), canonicalizeJsonPayload(fresh) + "\n");
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const { theme: _unusedTheme, ...initialWithoutTheme } = initial;
  const presentation = {
    ...initialWithoutTheme,
    scene: [
      {
        id: "hero-one",
        component: { id: "hero", version: 1 },
        props: { title: "Locked React" },
        owner: { kind: "presentation" },
        audience: { kind: "all" },
        parent: { kind: "stage" },
        physicalSizeMeters: [1.6, 0.9],
        fit: "contain",
        transform: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ],
    assets: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  };
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `import {definePresentation} from "@unframe/unframe-authoring";\nimport {Hero} from "./Hero.component";\nconst base = ${JSON.stringify(presentation)};\nconst hero = ${JSON.stringify(presentation.scene[0])};\nexport default definePresentation({...base, scene: [{...hero, component: Hero}]});`,
  );
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe/unframe-authoring";
import {Button} from "@base-ui/react/button";
import "./hero.css";
export const Hero = defineComponent({
  id: "hero", version: 1,
  props: {title: editableText({required: true})},
  surface: {logicalSize: [800, 450]},
  semantics: {rootNodeIds: ["title"], nodes: {
    title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}
  }},
  render: ({texts, bindings}: {texts: {title: string}; bindings: {title: {"data-unframe-binding": string}}}) =>
    <main className="hero"><h1 {...bindings.title}>{texts.title}</h1><Button disabled>Preview only</Button></main>,
});`,
  );
  await writeFile(
    join(directory, "hero.css"),
    `@font-face { font-family: Fixture; src: url("fixture.ttf") format("truetype"); }
html, body { margin: 0; }
.hero { width: 800px; height: 450px; padding: 24px; box-sizing: border-box; font-family: Fixture; background: #fff url("fixture.png") no-repeat right bottom; }
.hero h1 { font-size: 52px; color: #102a43; }
.hero button { padding: 12px 18px; color: #fff; background: #102a43; border: 0; }`,
  );
  await cp(
    join(repository, "app/unity/Assets/TextMesh Pro/Fonts/LiberationSans.ttf"),
    join(directory, "fixture.ttf"),
  );
  await cp(join(repository, "assets/icon.png"), join(directory, "fixture.png"));
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const frozen = loadUnframeLock(discovered.lockBytes);
  assert(frozen.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    rawFiles: discovered.localFiles
      .filter(({ path }) => /\.(css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
    ...frozen.value.virtualSource,
  });
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return directory;
};

const distBytes = async (directory: string) => {
  const output = new Map<string, Uint8Array>();
  const visit = async (path: string): Promise<void> => {
    const names = await readdir(join(directory, "dist", path), { withFileTypes: true });
    for (const name of names) {
      const relative = path ? `${path}/${name.name}` : name.name;
      if (name.isDirectory()) await visit(relative);
      else output.set(relative, await readFile(join(directory, "dist", relative)));
    }
  };
  await visit("");
  return [...output.entries()].sort(([a], [b]) => a.localeCompare(b));
};

it("builds Base UI Button with locked React, CSS, font, and image twice to identical bytes", async () => {
  const directory = await createProject();
  const refresh = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refresh.exitCode, refresh.stderr).toBe(0);
  const checked = await runPresentationCli({ args: ["check", directory] });
  expect(checked.exitCode, checked.stderr).toBe(0);
  const firstStarted = performance.now();
  const first = await runPresentationCli({ args: ["build", directory] });
  const firstDuration = performance.now() - firstStarted;
  expect(first.exitCode, first.stderr).toBe(0);
  const bytes = await distBytes(directory);
  const captured = bytes.find(([path]) => path.endsWith(".png"));
  assert(captured);
  await writeFile("/tmp/unframe-a2-hero.png", captured[1]);
  const secondStarted = performance.now();
  const second = await runPresentationCli({ args: ["build", directory] });
  const secondDuration = performance.now() - secondStarted;
  expect(second.exitCode, second.stderr).toBe(0);
  expect(await distBytes(directory)).toEqual(bytes);
  console.info(
    `Opaque Base UI build durations: ${Math.round(firstDuration)} ms, ${Math.round(secondDuration)} ms`,
  );
  const componentPath = join(directory, "Hero.component.tsx");
  const component = await readFile(componentPath, "utf8");
  await writeFile(
    componentPath,
    component
      .replace(
        '<main className="hero">',
        '(fetch("https://example.com/blocked").catch(() => {}), <main className="hero">',
      )
      .replace("</main>,", "</main>),"),
  );
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  const blocked = await runPresentationCli({ args: ["build", directory] });
  expect(blocked.exitCode).not.toBe(0);
  expect(blocked.stderr).toContain("opaque-capability-denied");
  expect(await distBytes(directory)).toEqual(bytes);
}, 240_000);
