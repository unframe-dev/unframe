import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, describe, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject, checkAuthoringProjectAssembly } from "@unframe/unframe-compiler";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import {
  hashDependencyGraph,
  hashLockedPackageContent,
  hashPackageLocator,
} from "../src/filesystem/lock-v2.js";
import { lockedFile } from "../src/filesystem/package-snapshot.js";

const temporary: string[] = [];
const reference = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/presentation");
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const component = `import {defineComponent, editableText, prop} from "@unframe/unframe-authoring";
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
  const directory = await mkdtemp(join(tmpdir(), "unframe-react-"));
  temporary.push(directory);
  await cp(reference, directory, { recursive: true });
  const discovery = await discoverPresentationProjectFiles(directory);
  assert(discovery.ok);
  const loaded = loadUnframeLock(discovery.lockBytes);
  assert(loaded.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovery.entryFile,
    files: discovery.files,
    ...loaded.value.virtualSource,
  });
  assert(checked.valid);
  const presentation = {
    ...checked.value.presentation.value,
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
  await writeFile(
    join(directory, "unframe.lock"),
    canonicalizeJsonPayload({ ...loaded.value.lock, assets: [] }) + "\n",
  );
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const source = `import {definePresentation} from "@unframe/unframe-authoring";
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

describe("React frozen CLI path", () => {
  it("refreshes and checks a Component imported from a locked package export", async () => {
    const directory = await createProject();
    const entry = join(directory, "presentation.unframe.tsx");
    await writeFile(
      entry,
      (await readFile(entry, "utf8")).replace('"./Hero.component"', '"ui-kit"'),
    );
    await rm(join(directory, "Hero.component.tsx"));
    const loaded = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
    assert(loaded.ok);
    const sdk = loaded.value.lock.rootDependencies.find(
      (edge) => edge.specifier === "@unframe/unframe-authoring",
    );
    assert(sdk);
    const file = lockedFile(
      "Hero.component.tsx",
      new TextEncoder().encode('import "./helper.js";\n' + component),
    );
    const packageKey = hashPackageLocator("ui-kit@1.0.0");
    const packageSnapshot = {
      key: packageKey,
      locator: "ui-kit@1.0.0",
      name: "ui-kit",
      version: "1.0.0",
      files: [
        file,
        lockedFile("helper.js", new TextEncoder().encode('import "./style.css";')),
        lockedFile(
          "index.d.ts",
          new TextEncoder().encode('export { Hero } from "./Hero.component";'),
        ),
        lockedFile(
          "style.css",
          new TextEncoder().encode('.hero { background: url("./texture.png"); }'),
        ),
        lockedFile("texture.png", new Uint8Array([137, 80, 78, 71])),
      ],
      exports: [
        {
          subpath: ".",
          runtimeImport: "Hero.component.tsx",
          runtimeRequire: null,
          types: "index.d.ts",
        },
      ],
      dependencies: [sdk],
    };
    const next = {
      ...loaded.value.lock,
      rootDependencies: [
        ...loaded.value.lock.rootDependencies,
        {
          specifier: "ui-kit",
          usage: "runtime" as const,
          packageKey,
        },
      ].sort((a, b) => a.specifier.localeCompare(b.specifier)),
      packages: [
        ...loaded.value.lock.packages,
        {
          ...packageSnapshot,
          contentIntegrity: hashLockedPackageContent(packageSnapshot),
        },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    };
    await writeFile(
      join(directory, "unframe.lock"),
      canonicalizeJsonPayload({
        ...next,
        dependencyGraphHash: hashDependencyGraph(next),
      }) + "\n",
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const frozen = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
    assert(frozen.ok);
    expect(
      frozen.value.lock.componentLocks.find((item) => item.componentId === "hero")?.origin,
    ).toEqual({ kind: "package", packageKey, subpath: "." });
    const checked = await runPresentationCli({ args: ["check", directory] });
    expect(checked.exitCode).toBe(0);
    for (const helper of [
      'require("./style.css");',
      'import("ui-unlocked");',
      'import "ui-unlocked";',
    ]) {
      const current = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
      assert(current.ok);
      const packages = current.value.lock.packages.map((pkg) => {
        if (pkg.key !== packageKey) return pkg;
        const files = pkg.files.map((item) =>
          item.path === "helper.js"
            ? lockedFile("helper.js", new TextEncoder().encode(helper))
            : item,
        );
        const changed = { ...pkg, files };
        return { ...changed, contentIntegrity: hashLockedPackageContent(changed) };
      });
      const changed = { ...current.value.lock, packages };
      const lockBytes = new TextEncoder().encode(
        canonicalizeJsonPayload({
          ...changed,
          dependencyGraphHash: hashDependencyGraph(changed),
        }) + "\n",
      );
      await writeFile(join(directory, "unframe.lock"), lockBytes);
      const rejected = await runPresentationCli({ args: ["lock", "refresh", directory] });
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain("compiler-frozen-input-invalid");
      expect(await readFile(join(directory, "unframe.lock"))).toEqual(Buffer.from(lockBytes));
    }
  }, 30000);
  it("refreshes a Component lock and checks without evaluating render or opening a Browser", async () => {
    const directory = await createProject();
    const refreshed = await runPresentationCli({
      args: ["lock", "refresh", directory, "--format", "json"],
    });
    expect(refreshed.stderr).toBe("");
    expect(refreshed.exitCode).toBe(0);
    const frozenLock = await readFile(join(directory, "unframe.lock"));
    const checked = await runPresentationCli({ args: ["check", directory] });
    expect(checked.stderr).toBe("");
    expect(checked.stdout).toBe("check: ok\n");
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
    expect(built.stderr).toContain("compiler-opaque-component-unsupported");
    expect(opened).toBe(false);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(frozenLock);
  });
  it("rejects source drift and preserves the previous lock when refresh fails", async () => {
    const directory = await createProject();
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode).toBe(0);
    const before = await readFile(join(directory, "unframe.lock"));
    await writeFile(
      join(directory, "Hero.component.tsx"),
      component.replace('id: "hero"', "id: mutate()"),
    );
    const checked = await runPresentationCli({ args: ["check", directory] });
    expect(checked.exitCode).toBe(1);
    expect(checked.stderr).toContain("cli-local-file-hash-mismatch");
    const failed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(failed.exitCode).toBe(1);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(before);
  });
  it("recreates v1 from a frozen pnpm archive without running package scripts", async () => {
    const directory = await createProject();
    const lockPath = join(directory, "unframe.lock");
    const old = loadUnframeLock(await readFile(lockPath));
    assert(old.ok);
    const sdk = old.value.lock.packages.find((pkg) => pkg.name === "@unframe/unframe-authoring");
    assert(sdk);
    const staging = await mkdtemp(join(tmpdir(), "unframe-sdk-"));
    temporary.push(staging);
    await mkdir(join(staging, "package"));
    for (const file of sdk.files) {
      await mkdir(dirname(join(staging, "package", file.path)), { recursive: true });
      await writeFile(
        join(staging, "package", file.path),
        file.encoding === "utf8" ? file.data : Buffer.from(file.data, "base64"),
      );
    }
    await writeFile(
      join(staging, "package/package.json"),
      JSON.stringify({
        name: sdk.name,
        version: "1.0.0",
        type: "module",
        exports: Object.fromEntries(
          sdk.exports.map((entry) => [
            entry.subpath,
            { types: `./${entry.types}`, default: `./${entry.runtimeImport}` },
          ]),
        ),
        scripts: {
          postinstall: "node -e \"require('fs').writeFileSync('script-executed', 'bad')\"",
        },
      }),
    );
    await mkdir(join(directory, "vendor"));
    await promisify(execFile)("tar", [
      "-czf",
      join(directory, "vendor/authoring.tgz"),
      "-C",
      staging,
      "package",
    ]);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, dependencies: { [sdk.name]: "file:vendor/authoring.tgz" } }),
    );
    await promisify(execFile)(
      "pnpm",
      ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"],
      { cwd: directory, timeout: 30000 },
    );
    await writeFile(lockPath, '{"schemaVersion":1}');
    const recreated = await runPresentationCli({
      args: ["lock", "update", directory, "--recreate"],
    });
    expect(recreated.stderr).toBe("");
    expect(recreated.exitCode).toBe(0);
    expect(loadUnframeLock(await readFile(lockPath))).toMatchObject({ ok: true });
    const checked = await runPresentationCli({ args: ["check", directory] });
    expect(checked.stderr).toBe("");
    expect(checked.exitCode).toBe(0);
    await expect(
      readFile(join(directory, "node_modules/@unframe/unframe-authoring/script-executed")),
    ).rejects.toThrow();
  }, 30000);
  it("keeps v1 bytes when explicit recreation lacks package inputs", async () => {
    const directory = await createProject();
    const before = '{"schemaVersion":1}';
    await writeFile(join(directory, "unframe.lock"), before);
    const result = await runPresentationCli({ args: ["lock", "update", directory, "--recreate"] });
    expect(result.exitCode).toBe(1);
    expect(await readFile(join(directory, "unframe.lock"), "utf8")).toBe(before);
  });
  it("keeps semantic Instance IDs across Component relocation and Props changes", async () => {
    const directory = await createProject();
    const ids = async () => {
      const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
      expect(refreshed.exitCode).toBe(0);
      const discovered = await discoverPresentationProjectFiles(directory);
      assert(discovered.ok);
      const lock = loadUnframeLock(discovered.lockBytes);
      assert(lock.ok);
      const checked = checkAuthoringProjectAssembly(
        {
          projectRoot: directory,
          entryFile: discovered.entryFile,
          files: discovered.files,
          ...lock.value.virtualSource,
        },
        lock.value.assemblyCarrier,
      );
      if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
      const componentLock = lock.value.lock.componentLocks.find(
        (item) => item.componentId === "hero",
      );
      assert(componentLock?.mode === "opaque");
      return {
        nodes: Object.keys(checked.value.definition.scene.nodes).sort(),
        surfaces: Object.keys(checked.value.definition.scene.surfaces).sort(),
        rendererInputHash: componentLock.rendererInputHash,
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
  it("freezes CSS image and font dependencies and rejects remote CSS references", async () => {
    const directory = await createProject();
    await writeFile(join(directory, "Hero.component.tsx"), 'import "./helper.js";\n' + component);
    await writeFile(join(directory, "helper.js"), 'import "./hero.css";');
    await writeFile(
      join(directory, "hero.css"),
      '@font-face { font-family: Hero; src: url("./hero.ttf"); } .hero { background: url("./hero.png"); }',
    );
    await writeFile(join(directory, "hero.ttf"), new Uint8Array([0, 1, 2, 3]));
    await writeFile(join(directory, "hero.png"), new Uint8Array([137, 80, 78, 71]));
    expect((await runPresentationCli({ args: ["lock", "refresh", directory] })).exitCode).toBe(0);
    const lock = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
    assert(lock.ok);
    const origin = lock.value.lock.componentLocks.find(
      (item) => item.componentId === "hero",
    )?.origin;
    assert(origin?.kind === "local");
    expect(origin.files.map((file) => file.path)).toEqual([
      "Hero.component.tsx",
      "helper.js",
      "hero.css",
      "hero.png",
      "hero.ttf",
    ]);
    const rendererLock = lock.value.lock.componentLocks.find((item) => item.componentId === "hero");
    assert(rendererLock?.mode === "opaque");
    let rendererHash = rendererLock.rendererInputHash;
    for (const [path, bytes] of [
      ["helper.js", 'import "./hero.css";\n'],
      [
        "hero.css",
        '@font-face { font-family: Hero; src: url("./hero.ttf"); } .hero { background: url("./hero.png"); }\n',
      ],
      ["hero.png", new Uint8Array([137, 80, 78, 72])],
      ["hero.ttf", new Uint8Array([0, 1, 2, 4])],
    ] as const) {
      await writeFile(join(directory, path), bytes);
      expect((await runPresentationCli({ args: ["lock", "refresh", directory] })).exitCode).toBe(0);
      const changed = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
      assert(changed.ok);
      const changedLock = changed.value.lock.componentLocks.find(
        (item) => item.componentId === "hero",
      );
      assert(changedLock?.mode === "opaque");
      expect(changedLock.rendererInputHash, path).not.toBe(rendererHash);
      rendererHash = changedLock.rendererInputHash;
    }
    const before = await readFile(join(directory, "unframe.lock"));
    await writeFile(
      join(directory, "hero.css"),
      '.hero { background: url("https://example.com/hero.png"); }',
    );
    const failed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(failed.exitCode).toBe(1);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(before);
    await writeFile(
      join(directory, "hero.css"),
      '@font-face { font-family: Hero; src: url("./hero.ttf"); } .hero { background: url("./hero.png"); }',
    );
    await writeFile(join(directory, "helper.js"), 'require("./hero.css");');
    const dynamic = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(dynamic.exitCode).toBe(1);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(before);
  }, 30000);
});
