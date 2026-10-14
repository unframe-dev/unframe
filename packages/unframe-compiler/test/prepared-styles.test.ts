import { assert, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { computeFrozenComponentInputs } from "../src/semantic/frozen-component-inputs.js";

const hash = (text: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
const project = (
  css = ".hero { color: red; filter: url(#shadow) }",
  identity = hash("node24-linux"),
) => {
  const files = [
    {
      fileName: "Hero.component.tsx",
      sourceText: 'import "./styles/entry.css"; export const render = () => null;',
    },
    { fileName: "arbitrary-helper.ts", sourceText: "const broken = ;" },
  ];
  const rawFiles = [
    {
      path: "styles/entry.css",
      mediaType: "text/css",
      encoding: "utf8",
      data: '@import "tailwindcss";',
      hash: hash('@import "tailwindcss";'),
    },
  ];
  return {
    projectRoot: "/virtual",
    entryFile: "Hero.component.tsx",
    files,
    rawFiles,
    rootDependencies: [],
    packages: [],
    preparedStyles: {
      identity,
      inputs: [
        ...files.map((file) => ({ path: file.fileName, hash: hash(file.sourceText) })),
        ...rawFiles.map(({ path, hash }) => ({ path, hash })),
      ],
      stylesheets: [{ entry: "styles/entry.css", css }],
    },
  };
};
const catalog = {
  components: [
    {
      manifest: {
        fileName: "Hero.component.tsx",
        value: {
          componentId: "hero",
          version: 1,
          authoring: { mode: "opaque" },
          semantics: { surfaces: [] },
        },
      },
      renderer: {
        entrySource: 'import "./styles/entry.css"; export const render = () => null;',
        localDependencies: ["styles/entry.css"],
        packageImports: [],
      },
    },
  ],
  themes: [],
} as never;

it("keeps unreachable config helper syntax as snapshot bytes without authoring analysis", () => {
  const result = parseAuthoringProject(project());
  assert(result.ok);
  expect(result.value.files["arbitrary-helper.ts"]?.text).toBe("const broken = ;");
});

it.each(["missing", "mismatch", "duplicate", "entry"])(
  "rejects prepared styles with %s snapshot correspondence",
  (reason) => {
    const input = project();
    if (reason === "missing") input.preparedStyles.inputs.pop();
    if (reason === "mismatch") input.preparedStyles.inputs[0]!.hash = hash("different");
    if (reason === "duplicate") input.preparedStyles.inputs.push(input.preparedStyles.inputs[0]!);
    if (reason === "entry") input.preparedStyles.stylesheets[0]!.entry = "absent.css";
    expect(parseAuthoringProject(input)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "compiler-prepared-styles-invalid" })],
    });
  },
);

it("uses transformed CSS for the frozen closure and invalidates locks for generated output and environment", () => {
  const base = computeFrozenComponentInputs(project(), catalog);
  assert(base.valid);
  const cssChanged = computeFrozenComponentInputs(project(".hero {color: blue}"), catalog);
  const environmentChanged = computeFrozenComponentInputs(
    project(undefined, hash("node24-darwin")),
    catalog,
  );
  assert(cssChanged.valid && environmentChanged.valid);
  const original = base.value.componentLocks[0]!;
  for (const changed of [cssChanged, environmentChanged]) {
    expect(changed.value.componentLocks[0]!.origin).toEqual(original.origin);
    expect(changed.value.componentLocks[0]).not.toEqual(original);
  }
});

it("includes helper content and snapshot additions in frozen identity", () => {
  const base = computeFrozenComponentInputs(project(), catalog);
  assert(base.valid);
  const changed = project();
  changed.files[1]!.sourceText = 'export const theme = "blue";';
  changed.preparedStyles.inputs[1]!.hash = hash(changed.files[1]!.sourceText);
  changed.rawFiles.push({
    path: "candidate.md",
    mediaType: "text/plain",
    encoding: "utf8",
    data: "bg-blue-500",
    hash: hash("bg-blue-500"),
  });
  changed.preparedStyles.inputs.push({ path: "candidate.md", hash: hash("bg-blue-500") });
  const result = computeFrozenComponentInputs(changed, catalog);
  assert(result.valid);
  expect(result.value.componentLocks).not.toEqual(base.value.componentLocks);
});

it("canonicalizes prepared input ordering while retaining the original CSS hash", () => {
  const input = project();
  const normal = computeFrozenComponentInputs(input, catalog);
  assert(normal.valid);
  input.preparedStyles.inputs.reverse();
  const reversed = computeFrozenComponentInputs(input, catalog);
  assert(reversed.valid);
  expect(reversed.value).toEqual(normal.value);
  expect(normal.value.componentLocks[0]!.origin).toMatchObject({
    files: expect.arrayContaining([
      { path: "styles/entry.css", hash: hash('@import "tailwindcss";') },
    ]),
  });
});

it.each(["!", "Zg=", "Zh=="])("reports invalid base64 %s as a raw-file diagnostic", (data) => {
  const input = project();
  input.rawFiles.push({
    path: "image.png",
    mediaType: "image/png",
    encoding: "base64",
    data,
    hash: hash("f"),
  });
  input.preparedStyles.inputs.push({ path: "image.png", hash: hash("f") });

  expect(parseAuthoringProject(input)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({ code: "compiler-invalid-input", fileName: "image.png" }),
    ],
  });
});
