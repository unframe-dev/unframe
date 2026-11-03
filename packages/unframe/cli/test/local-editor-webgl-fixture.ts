import { sourceAssetPorts } from "../src/application/media-ports.js";
import assert from "node:assert/strict";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";
import { prepareProjectFixture } from "./prepared-project-fixture.js";
import { prepareRealReactProjectFixture } from "./real-react-project-fixture.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAuthoringProject } from "@unframe-dev/source";
import { discoverPresentationProjectFiles } from "@unframe-dev/workspace-node";
import { prepareProjectSource } from "@unframe-dev/workspace-node";
import { lockedFile } from "@unframe-dev/workspace-node";
const repository = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const createWebglCaptureProject = async (
  kind: "opaque" | "structured" = "opaque",
  extended = false,
) => {
  const directory =
    kind === "structured"
      ? await prepareProjectFixture()
      : extended
        ? await prepareRealReactProjectFixture()
        : (await prepareReactProjectFixture()).directory;
  if (kind === "structured") return directory;
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const initial = checkAuthoringProject(
    (await prepareProjectSource(sourceAssetPorts.styles, discovered, discovered.dependencyGraph))
      .source,
  );
  assert(initial.valid, JSON.stringify(initial.diagnostics));
  if (!extended) {
    const runtime = await readFixtureGraph(
      new URL("./fixtures/react-graph.json.gz", import.meta.url),
    );
    await rm(join(directory, "node_modules"), { recursive: true });
    await installFixtureGraph(directory, runtime);
  }
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
    `import {definePresentation} from "@unframe-dev/authoring";\nimport {Hero} from "./Hero.component";\nconst base = ${JSON.stringify(presentation)};\nexport default definePresentation({...base, scene: [${sceneSource}]});`,
  );
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe-dev/authoring";
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
  const checkedFiles = await discoverPresentationProjectFiles(directory);
  assert(checkedFiles.ok);
  const checked = checkAuthoringProject({
    ...(
      await prepareProjectSource(
        sourceAssetPorts.styles,
        checkedFiles,
        checkedFiles.dependencyGraph,
      )
    ).source,
    rawFiles: checkedFiles.localFiles
      .filter(({ path }) => /\.(css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
  });
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return directory;
};
