import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createDeliveryFixtureProject } from "../../packages/unframe/compiler/test/fixtures/plan-project.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const execute = promisify(execFile);
const requireHere = createRequire(import.meta.url);

test("packed Source and Compiler work from fixed inputs without workspace source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-compiler-"));
  try {
    for (const name of ["authoring", "presentation", "artifacts", "source", "compiler"]) {
      const source = resolve(root, "packages/unframe", name);
      const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      const target = join(directory, "node_modules/@unframe", name);
      await mkdir(target, { recursive: true });
      await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          type: "module",
          exports: pkg.publishConfig.exports,
        }),
      );
    }
    const copied = new Set();
    const copyExternal = async (name, resolver) => {
      if (copied.has(name)) return;
      const manifest = await realpath(resolver.resolve(`${name}/package.json`));
      const pkg = JSON.parse(await readFile(manifest, "utf8"));
      const target = join(directory, "node_modules", name);
      await mkdir(dirname(target), { recursive: true });
      await cp(dirname(manifest), target, { recursive: true });
      copied.add(name);
      const next = createRequire(manifest);
      for (const dependency of Object.keys(pkg.dependencies ?? {}))
        await copyExternal(dependency, next);
    };
    const requireCompiler = createRequire(resolve(root, "packages/unframe/compiler/package.json"));
    const requireSource = createRequire(resolve(root, "packages/unframe/source/package.json"));
    await copyExternal("zod", requireCompiler);
    await copyExternal("typescript", requireSource);
    await copyExternal("@types/react", requireSource);
    await writeFile(
      join(directory, "project.json"),
      JSON.stringify(createDeliveryFixtureProject()),
    );
    const hash = (letter) => `sha256:${letter.repeat(64)}`;
    const fixedSource = {
      projectRoot: "/virtual",
      entryFile: "entry.ts",
      files: [
        {
          fileName: "entry.ts",
          sourceText: `import { definePresentation } from "@unframe/authoring";
export default definePresentation({ id: "fixed-source", metadata: { title: "Fixed" }, stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] }, scene: { spatial: [], components: [] }, assets: [], flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: [] });`,
        },
      ],
      rootDependencies: [
        { specifier: "@unframe/authoring", usage: "runtime", packageKey: hash("a") },
      ],
      packages: [
        {
          key: hash("a"),
          locator: "@unframe/authoring@1",
          name: "@unframe/authoring",
          version: "1",
          contentIntegrity: hash("b"),
          files: [
            {
              path: "index.ts",
              mediaType: "text/typescript",
              hash: hash("c"),
              encoding: "utf8",
              data: "export const definePresentation = (...args: unknown[]) => { throw 0; };",
            },
          ],
          exports: [
            { subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" },
          ],
          dependencies: [],
        },
      ],
    };
    await writeFile(join(directory, "source.json"), JSON.stringify(fixedSource));
    await writeFile(
      join(directory, "consumer.mjs"),
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAuthoringProject, hashSourceTypeLibraries } from "@unframe/source";
import { compileDeclarationPlan } from "@unframe/compiler";
const source = checkAuthoringProject({projectRoot:"/virtual", entryFile:"entry.component.tsx", files:[{fileName:"entry.component.tsx", sourceText:"export const value = 1;"}], rootDependencies:[], packages:[]});
assert.equal(source.valid, false);
assert.ok(source.diagnostics.some(d => d.code === "source-type-library-missing"));
assert.match(hashSourceTypeLibraries([]), /^sha256:[0-9a-f]{64}$/);
const fixed = JSON.parse(readFileSync(new URL("source.json", import.meta.url), "utf8"));
const declaration = checkAuthoringProject(fixed);
assert.equal(declaration.valid, true, JSON.stringify(declaration.diagnostics));
const fixedPlan = compileDeclarationPlan({ presentation: declaration.value.presentation.value, themes: [], components: [], assets: {} });
assert.equal(fixedPlan.valid, true, JSON.stringify(fixedPlan.diagnostics));
assert.equal(fixedPlan.value.definition.presentationId, "fixed-source");
const project = JSON.parse(readFileSync(new URL("project.json", import.meta.url), "utf8"));
const plan = compileDeclarationPlan(project, {id:"baked-web", version:"1", contractVersion:"1", implementationHash:"sha256:test"});
assert.equal(plan.valid, true, JSON.stringify(plan.diagnostics));
assert.equal(plan.value.definition.presentationId, "compiler-wire-fixture");
assert.equal(Object.keys(plan.value.renderPlan.surfaces).length, 1);
`,
    );
    await writeFile(
      join(directory, "consumer.mts"),
      `
import { checkAuthoringProject } from "@unframe/source";
import { compileDeclarationPlan, type CompilerDeclarationProject } from "@unframe/compiler";
declare const project: CompilerDeclarationProject;
void [checkAuthoringProject, compileDeclarationPlan(project)];
`,
    );
    await execute(process.execPath, [join(directory, "consumer.mjs")], { cwd: directory });
    await execute(
      process.execPath,
      [
        requireHere.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "consumer.mts",
      ],
      { cwd: directory },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
