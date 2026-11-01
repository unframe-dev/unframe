import { sourceAssetPorts } from "../src/application/media-ports.js";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it } from "vitest";
import { validatePresentationArtifacts, verifyBuildIntegrity } from "@unframe/artifacts";
import { checkAuthoringProject } from "@unframe/source";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "@unframe/workspace-node";
import { prepareProjectSource } from "@unframe/workspace-node";
import { loadUnframeLock } from "@unframe/workspace";
import { lockedFile } from "@unframe/workspace-node";
import { prepareRealReactProjectFixture } from "./real-react-project-fixture.js";

const repository = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fromReference = async (directory: string) => {
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const checked = checkAuthoringProject(
    (await prepareProjectSource(sourceAssetPorts.styles, discovered, loaded.value.lock)).source,
  );
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return { loaded: loaded.value.lock, presentation: checked.value.presentation.value };
};

const createProject = async (mixed = false) => {
  const directory = await prepareRealReactProjectFixture();
  temporary.push(directory);
  const { presentation: initial } = await fromReference(directory);
  for (const name of await readdir(directory))
    if (
      !mixed &&
      (name.endsWith(".manifest.ts") ||
        name.endsWith(".structure.tsx") ||
        name === "reference-locks.ts")
    )
      await rm(join(directory, name));
  const { theme: _unusedTheme, ...initialWithoutTheme } = initial;
  const presentation = {
    ...initialWithoutTheme,
    scene: [
      {
        id: "hero-one",
        component: { id: "hero", version: 1 },
        props: { title: "Bold" },
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
    `import {definePresentation} from "@unframe/authoring";\nimport {Hero} from "./Hero.component";\nconst base = ${JSON.stringify(mixed ? initial : presentation)};\nconst hero = ${JSON.stringify(presentation.scene[0])};\nexport default definePresentation({...base, scene: ${mixed ? "{...base.scene, components: [...base.scene.components, {...hero, component: Hero}]}" : "[{...hero, component: Hero}]"}});`,
  );
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe/authoring";
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
    <main className="hero"><h1 {...bindings.title}>{texts.title}</h1><Button disabled>Bold</Button></main>,
});`,
  );
  await writeFile(
    join(directory, "hero.css"),
    `@font-face { font-family: Fixture; src: url("fixture.ttf") format("truetype"); }
html, body { margin: 0; }
.hero { width: 800px; height: 450px; padding: 24px; box-sizing: border-box; font-family: Fixture; background: #fff url("fixture.png") no-repeat right bottom; }
.hero h1 { font-size: 52px; font-weight: 400; color: #102a43; }
.hero button { font: 400 16px Fixture; padding: 12px 18px; color: #fff; background: #102a43; border: 0; }`,
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
    ...(await prepareProjectSource(sourceAssetPorts.styles, discovered, frozen.value.lock)).source,
    rawFiles: discovered.localFiles
      .filter(({ path }) => /\.(css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
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

const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const distHashes = (files: [string, Uint8Array][]) =>
  files.map(([path, bytes]) => [path, hashBytes(bytes)]);
const pngHashes = (files: [string, Uint8Array][]) =>
  files.filter(([path]) => path.endsWith(".png")).map(([path, bytes]) => [path, hashBytes(bytes)]);

const renderBundleHash = async (directory: string) => {
  const manifest = JSON.parse(
    await readFile(join(directory, "dist", "build-manifest.json"), "utf8"),
  ) as { renderBundleHash: string };
  return manifest.renderBundleHash;
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
  const initialRenderHash = await renderBundleHash(directory);
  const captured = bytes.find(([path]) => path.endsWith(".png"));
  assert(captured);
  await writeFile("/tmp/unframe-a2-hero.png", captured[1]);
  const secondStarted = performance.now();
  const second = await runPresentationCli({ args: ["build", directory] });
  const secondDuration = performance.now() - secondStarted;
  expect(second.exitCode, second.stderr).toBe(0);
  // The receipt identifies each publication generation rather than deterministic build content.
  const buildContent = (files: [string, Uint8Array][]) =>
    files.filter(([path]) => path !== "build-receipt.json");
  expect(distHashes(buildContent(await distBytes(directory)))).toEqual(
    distHashes(buildContent(bytes)),
  );
  console.info(
    `Opaque Base UI build durations: ${Math.round(firstDuration)} ms, ${Math.round(secondDuration)} ms`,
  );
  const cssPath = join(directory, "hero.css");
  const css = await readFile(cssPath, "utf8");
  await writeFile(cssPath, css.replace("color: #102a43;", "color: #a00000;"));
  const refreshedCssLock = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshedCssLock.exitCode, refreshedCssLock.stderr).toBe(0);
  const cssChangedBuild = await runPresentationCli({ args: ["build", directory] });
  expect(cssChangedBuild.exitCode, cssChangedBuild.stderr).toBe(0);
  const cssChangedBytes = await distBytes(directory);
  expect(pngHashes(cssChangedBytes)).not.toEqual(pngHashes(bytes));
  const cssRenderHash = await renderBundleHash(directory);
  expect(cssRenderHash).not.toBe(initialRenderHash);
  const fontPath = join(directory, "fixture.otf");
  await cp(
    join(repository, "packages/unframe/render-browser/test/fixtures/UnframeFixtureCJK-Regular.otf"),
    fontPath,
  );
  await rm(join(directory, "fixture.ttf"));
  await writeFile(
    cssPath,
    (await readFile(cssPath, "utf8")).replace(
      'url("fixture.ttf") format("truetype")',
      'url("fixture.otf") format("opentype")',
    ),
  );
  const refreshedFontLock = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshedFontLock.exitCode, refreshedFontLock.stderr).toBe(0);
  const fontBuild = await runPresentationCli({ args: ["build", directory] });
  expect(fontBuild.exitCode, fontBuild.stderr).toBe(0);
  const fontBytes = await distBytes(directory);
  expect(pngHashes(fontBytes)).not.toEqual(pngHashes(cssChangedBytes));
  const fontRenderHash = await renderBundleHash(directory);
  expect(fontRenderHash).not.toBe(cssRenderHash);
  const componentPath = join(directory, "Hero.component.tsx");
  const component = await readFile(componentPath, "utf8");
  await writeFile(
    componentPath,
    component.replace(
      "<h1 {...bindings.title}>",
      "<h1 {...bindings.title} style={{fontSize: 32}}>",
    ),
  );
  const refreshedRenderLock = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshedRenderLock.exitCode, refreshedRenderLock.stderr).toBe(0);
  const renderBuild = await runPresentationCli({ args: ["build", directory] });
  expect(renderBuild.exitCode, renderBuild.stderr).toBe(0);
  const renderBytes = await distBytes(directory);
  expect(pngHashes(renderBytes)).not.toEqual(pngHashes(fontBytes));
  expect(await renderBundleHash(directory)).not.toBe(fontRenderHash);
  await writeFile(
    componentPath,
    (await readFile(componentPath, "utf8"))
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
  expect(distHashes(await distBytes(directory))).toEqual(distHashes(renderBytes));
}, 360_000);

it("builds Structured and finite-state React together and keeps textures stable after placement edits", async () => {
  const directory = await createProject(true);
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe/authoring";
import "./hero.css";
export const Hero = defineComponent({
 id:"hero",version:1,props:{title:editableText({required:true})},surface:{logicalSize:[800,450]},
 semantics:{rootNodeIds:["title","button"],nodes:{
  title:{role:"heading",level:1,parentId:null,order:0,text:prop("title")},
  button:{role:"button",parentId:null,order:1,text:"Reveal",interactionId:"reveal"}
 }},
 interactions:{reveal:{kind:"click",event:"reveal",hitPriority:2}},initialState:"hidden",actions:{},outputs:{},
 states:{hidden:{semanticOverrides:[],enabledInteractionIds:["reveal"]},revealed:{semanticOverrides:[],enabledInteractionIds:[]}},
 render:({texts,bindings,state}:{texts:{title:string;button:string};bindings:{title:{"data-unframe-binding":string};button:{"data-unframe-binding":string}};state:"hidden"|"revealed"})=><main className="hero"><h1 {...bindings.title} style={{color:state==="hidden"?"red":"blue"}}>{texts.title}</h1><button {...bindings.button} disabled={state!=="hidden"} style={{background:"transparent",width:240,height:60}}>{texts.button}</button></main>
});`,
  );
  const refresh = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refresh.exitCode, refresh.stderr).toBe(0);
  const checked = await runPresentationCli({ args: ["check", directory] });
  expect(checked.exitCode, checked.stderr).toBe(0);
  const started = performance.now();
  const first = await runPresentationCli({ args: ["build", directory] });
  expect(first.exitCode, first.stderr).toBe(0);
  console.info(`Mixed finite-state build: ${Math.round(performance.now() - started)} ms`);
  const bytes = await distBytes(directory);
  const readJson = async (name: string) =>
    JSON.parse(await readFile(join(directory, "dist", name), "utf8")) as unknown;
  const definition = await readJson("definition.json");
  const renderBundle = await readJson("render-bundle.json");
  const semantic = validatePresentationArtifacts(definition, renderBundle);
  expect(semantic.valid, JSON.stringify(semantic.diagnostics)).toBe(true);
  assert(semantic.valid);
  expect(
    new Set(
      Object.values(semantic.value.definition.scene.surfaces).map(
        (surface) => surface.content.kind,
      ),
    ),
  ).toEqual(new Set(["structured", "opaque"]));
  const opaque = Object.values(semantic.value.definition.scene.surfaces).find(
    (surface) => surface.content.kind === "opaque",
  );
  assert(opaque);
  expect(Object.keys(opaque.states)).toHaveLength(2);
  const rendered = semantic.value.renderBundle.surfaces[opaque.id];
  assert(rendered);
  expect(
    Object.values(rendered.interactionsByState)
      .map((regions) => regions.length)
      .sort(),
  ).toEqual([0, 1]);
  const integrity = verifyBuildIntegrity({
    definition,
    renderBundle,
    assetSet: await readJson("asset-set.json"),
    buildManifest: await readJson("build-manifest.json"),
  });
  expect(integrity.valid, JSON.stringify(integrity.diagnostics)).toBe(true);
  expect(bytes.some(([path]) => /\.(?:tsx?|jsx?|css)$/.test(path))).toBe(false);
  const entry = join(directory, "presentation.unframe.tsx");
  await writeFile(
    entry,
    (await readFile(entry, "utf8")).replace('"position":[0,1,-2]', '"position":[1,1,-2]'),
  );
  const moved = await runPresentationCli({ args: ["build", directory] });
  expect(moved.exitCode, moved.stderr).toBe(0);
  expect(pngHashes(await distBytes(directory))).toEqual(pngHashes(bytes));
}, 360_000);
