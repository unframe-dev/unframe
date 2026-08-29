import { describe, expect, it } from "vitest";

import { lowerAuthoringDeclarationFile } from "../src/lowering/lower-authoring-declaration.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

const builderNames = [
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
  "stringProp",
  "numberProp",
  "booleanProp",
  "slot",
  "part",
  "variant",
  "state",
  "action",
  "output",
  "surfaceState",
  "setSurfaceState",
  "playTimeline",
  "surfaceInteraction",
  "timelineCompleted",
  "mediaCompleted",
  "after",
  "invokeComponentAction",
  "componentOutput",
  "cue",
  "tokenRef",
  "namedStyleRef",
  "assetRef",
  "spatial",
  "frame",
  "text",
  "surface",
  "semanticOverride",
  "componentInstance",
  "detach",
];

const builderModule = builderNames
  .map((name) => `export const ${name} = (...args: unknown[]) => { throw 0; };`)
  .concat(
    "export const fakeBuilder = (...args: unknown[]) => { throw 0; };",
    "export default (...args: unknown[]) => { throw 0; };",
  )
  .join("\n");

const analyze = (
  sourceText: string,
  {
    files = [],
    packages = [],
  }: {
    readonly files?: readonly { readonly fileName: string; readonly sourceText: string }[];
    readonly packages?: readonly {
      readonly packageName: string;
      readonly packageVersion: string;
      readonly packageIntegrity: string;
      readonly files: readonly { readonly fileName: string; readonly sourceText: string }[];
      readonly exports: readonly { readonly subpath: string; readonly targetFile: string }[];
      readonly dependencies: readonly unknown[];
    }[];
  } = {},
) => {
  const presentationPackage = {
    packageName: "@unframe/presentation",
    packageVersion: "1",
    packageIntegrity: "integrity",
    files: [{ fileName: "index.ts", sourceText: builderModule }],
    exports: [{ subpath: ".", targetFile: "index.ts" }],
    dependencies: [],
  };
  const lockedPackages = [presentationPackage, ...packages];
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/presentation",
    entryFile: "presentation.ts",
    files: [{ fileName: "presentation.ts", sourceText }, ...files],
    packageDependencies: lockedPackages.map(
      ({ packageName, packageVersion, packageIntegrity }) => ({
        packageName,
        packageVersion,
        packageIntegrity,
      }),
    ),
    packages: lockedPackages,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const result = analyzeAuthoringProject(parsed.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

const lower = (sourceText: string, options?: Parameters<typeof analyze>[1]) =>
  lowerAuthoringDeclarationFile(analyze(sourceText, options));

describe("lowerAuthoringDeclarationFile", () => {
  it("lowers a direct provenanced root call without executing throwing builders", () => {
    const sourceText = [
      'import { definePresentation as presentation, stringProp as string, after } from "@unframe/presentation";',
      'export default presentation({ emoji: "😀", title: string({ default: "Hello" }), timer: after(100), number: -0, flags: [true, false, null] });',
    ].join("\n");
    const result = lower(sourceText);
    const rootStart = sourceText.indexOf("presentation({");

    expect(result).toEqual({
      ok: true,
      graph: {
        fileName: "presentation.ts",
        root: {
          kind: "builder-call",
          builder: "definePresentation",
          origin: {
            fileName: "presentation.ts",
            start: rootStart,
            end: sourceText.length - 1,
            line: 2,
            column: rootStart - sourceText.lastIndexOf("\n"),
          },
          arguments: [
            {
              kind: "object",
              origin: expect.any(Object),
              properties: expect.arrayContaining([
                {
                  key: "number",
                  origin: expect.any(Object),
                  value: expect.objectContaining({ kind: "literal", value: 0 }),
                },
                {
                  key: "title",
                  origin: expect.any(Object),
                  value: expect.objectContaining({
                    kind: "builder-call",
                    builder: "stringProp",
                    arguments: expect.any(Array),
                  }),
                },
                {
                  key: "timer",
                  origin: expect.any(Object),
                  value: expect.objectContaining({
                    kind: "builder-call",
                    builder: "after",
                    arguments: [expect.objectContaining({ kind: "literal", value: 100 })],
                  }),
                },
              ]),
            },
          ],
        },
      },
      diagnostics: [],
    });
  });

  it("preserves UTF-16 offsets and line columns after multiline emoji text", () => {
    const sourceText = [
      'import { definePresentation, stringProp } from "@unframe/presentation";',
      "export default definePresentation({",
      '  emoji: "😀",',
      "  value: stringProp({",
      '    label: "ok",',
      "  }),",
      "});",
    ].join("\n");
    const result = lower(sourceText);
    const position = (text: string) => {
      const start = sourceText.indexOf(text);
      const lineStart = sourceText.lastIndexOf("\n", start);
      return {
        fileName: "presentation.ts",
        start,
        end: start + text.length,
        line: sourceText.slice(0, start).split("\n").length,
        column: start - lineStart,
      };
    };
    if (!result.ok) throw new Error("expected lowered declaration");
    const rootObject = result.graph.root.arguments[0];
    if (rootObject?.kind !== "object") throw new Error("expected root object");
    const emoji = rootObject.properties[0];
    const value = rootObject.properties[1];
    expect(emoji).toMatchObject({ key: "emoji", origin: position("emoji") });
    expect(value).toMatchObject({ key: "value", origin: position("value") });
    if (value?.value.kind !== "builder-call") throw new Error("expected nested builder");
    expect(value.value.origin).toEqual(position('stringProp({\n    label: "ok",\n  })'));
    const nestedObject = value.value.arguments[0];
    if (nestedObject?.kind !== "object") throw new Error("expected nested object");
    const label = nestedObject.properties[0];
    expect(label?.origin).toEqual(position("label"));
    expect(label?.value).toMatchObject({ origin: position('"ok"') });
  });

  it("rejects unprovenanced root forms and root builders nested as values", () => {
    for (const sourceText of [
      "const definePresentation = (...args: unknown[]) => args; export default definePresentation({});",
      'import * as presentation from "@unframe/presentation"; export default presentation.definePresentation({});',
      'import presentation from "@unframe/presentation"; export default presentation({});',
      'import type { definePresentation } from "@unframe/presentation"; const local = (...args: unknown[]) => args; export default local({});',
      'import { definePresentation } from "@unframe/presentation"; const local = definePresentation; export default local({});',
      'import { fakeBuilder } from "@unframe/presentation"; export default fakeBuilder({});',
      'import { definePresentation } from "@unframe/presentation"; export default definePresentation({ nested: definePresentation({}) });',
    ]) {
      expect(lower(sourceText)).toMatchObject({
        ok: false,
        diagnostics: [{ code: expect.stringMatching(/^compiler-static-/) }],
      });
    }
  });

  it("preserves ordered multi-argument nested builder calls", () => {
    const result = lower(
      'import { definePresentation, setSurfaceState } from "@unframe/presentation"; export default definePresentation({ effect: setSurfaceState("surface", "state") });',
    );

    expect(result).toMatchObject({
      ok: true,
      graph: {
        root: {
          arguments: [
            {
              kind: "object",
              properties: [
                {
                  key: "effect",
                  value: {
                    kind: "builder-call",
                    builder: "setSurfaceState",
                    arguments: [
                      { kind: "literal", value: "surface" },
                      { kind: "literal", value: "state" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("reports the exact stable range for root and nested builder signatures", () => {
    const rootSource =
      'import { definePresentation } from "@unframe/presentation"; export default definePresentation();';
    const root = lower(rootSource);
    expect(root).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-builder-arguments-invalid",
          fileName: "presentation.ts",
          message: "Builder arguments do not match the static declaration signature.",
          start: rootSource.indexOf("definePresentation()"),
          end: rootSource.length - 1,
          line: 1,
          column: rootSource.indexOf("definePresentation()") + 1,
        },
      ],
    });
    const nestedSource =
      'import { definePresentation, after } from "@unframe/presentation"; export default definePresentation({ timer: after("bad") });';
    const nested = lower(nestedSource);
    const badStart = nestedSource.indexOf('"bad"');
    expect(nested).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-builder-arguments-invalid",
          fileName: "presentation.ts",
          start: badStart,
          end: badStart + '"bad"'.length,
          line: 1,
          column: badStart + 1,
        },
      ],
    });
  });

  it("accepts every builder signature class", () => {
    for (const sourceText of [
      'import { defineTheme } from "@unframe/presentation"; export default defineTheme({});',
      'import { defineComponentManifest } from "@unframe/presentation"; export default defineComponentManifest({});',
      'import { defineComponentStructure } from "@unframe/presentation"; export default defineComponentStructure({});',
      'import { definePresentation, state } from "@unframe/presentation"; export default definePresentation({ value: state() });',
      'import { definePresentation, stringProp } from "@unframe/presentation"; export default definePresentation({ value: stringProp({}) });',
      'import { definePresentation, surfaceState } from "@unframe/presentation"; export default definePresentation({ value: surfaceState("a", "b") });',
      'import { definePresentation, playTimeline } from "@unframe/presentation"; export default definePresentation({ value: playTimeline("a", {}) });',
      'import { definePresentation, after } from "@unframe/presentation"; export default definePresentation({ value: after(-0) });',
    ])
      expect(lower(sourceText)).toMatchObject({ ok: true });
  });

  it("rejects optional root and nested calls at their call ranges", () => {
    const rootSource =
      'import { definePresentation } from "@unframe/presentation"; export default definePresentation?.({});';
    const root = lower(rootSource);
    const rootStart = rootSource.indexOf("definePresentation?.");
    expect(root).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-root-invalid",
          start: rootStart,
          end: rootSource.length - 1,
        },
      ],
    });
    const nestedSource =
      'import { definePresentation, after } from "@unframe/presentation"; export default definePresentation({ value: after?.(1) });';
    const nested = lower(nestedSource);
    const nestedStart = nestedSource.indexOf("after?.");
    expect(nested).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-builder-invalid",
          start: nestedStart,
          end: nestedStart + "after?.(1)".length,
        },
      ],
    });
  });

  it("rejects side-effect, namespace, default, type-only, and non-builder imports", () => {
    for (const sourceText of [
      'import "@unframe/presentation"; import { definePresentation } from "@unframe/presentation"; export default definePresentation({});',
      'import * as builders from "@unframe/presentation"; import { definePresentation } from "@unframe/presentation"; export default definePresentation({});',
      'import defaultBuilder, { definePresentation } from "@unframe/presentation"; export default definePresentation({});',
      'import type { stringProp } from "@unframe/presentation"; import { definePresentation } from "@unframe/presentation"; export default definePresentation({});',
      'import { fakeBuilder, definePresentation } from "@unframe/presentation"; export default definePresentation({});',
    ]) {
      expect(lower(sourceText)).toMatchObject({
        ok: false,
        diagnostics: [{ code: "compiler-static-import-invalid", fileName: "presentation.ts" }],
      });
    }
  });

  it("reports exact stable diagnostics for unsupported static expression forms", () => {
    const prefix =
      'import { definePresentation } from "@unframe/presentation"; export default definePresentation(';
    const cases = [
      {
        value: "{ x: ({ a: 1 }).a }",
        code: "compiler-static-expression-unsupported",
        range: "({ a: 1 }).a",
      },
      {
        value: "{ __proto__: 1 }",
        code: "compiler-static-object-property-invalid",
        range: "__proto__",
      },
      { value: "{ values: [1,,2] }", code: "compiler-static-array-hole", range: "" },
      {
        value: "{ value: {} as unknown }",
        code: "compiler-static-expression-unsupported",
        range: "{} as unknown",
      },
      {
        value: "{ value: {} satisfies unknown }",
        code: "compiler-static-expression-unsupported",
        range: "{} satisfies unknown",
      },
    ] as const;
    for (const fixture of cases) {
      const sourceText = `${prefix}${fixture.value});`;
      const result = lower(sourceText);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const diagnostic = result.diagnostics[0]!;
      const start = fixture.range
        ? sourceText.indexOf(fixture.range)
        : sourceText.indexOf(",,") + 1;
      expect(diagnostic).toEqual({
        code: fixture.code,
        fileName: "presentation.ts",
        message: diagnostic.message,
        start,
        end: start + fixture.range.length,
        line: 1,
        column: start + 1,
      });
    }
  });

  it("uses UTF-16 offsets and canonical ordering for multiple lowerable diagnostics", () => {
    const sourceText =
      'import { definePresentation } from "@unframe/presentation"; export default definePresentation({ emoji: "😀", __proto__: 1, x: ({ a: 1 }).a, values: [1,,2] });';
    const result = lower(sourceText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, start }) => ({ code, start }))).toEqual([
      { code: "compiler-static-object-property-invalid", start: sourceText.indexOf("__proto__") },
      { code: "compiler-static-expression-unsupported", start: sourceText.indexOf("({ a: 1 }).a") },
      { code: "compiler-static-array-hole", start: sourceText.indexOf(",,") + 1 },
    ]);
    expect(result.diagnostics[1]).toMatchObject({
      start: sourceText.indexOf("({ a: 1 }).a"),
      end: sourceText.indexOf("({ a: 1 }).a") + "({ a: 1 }).a".length,
      line: 1,
      column: sourceText.indexOf("({ a: 1 }).a") + 1,
    });
  });

  it("rejects local aliases at the top-level statement range", () => {
    const sourceText =
      'import { definePresentation } from "@unframe/presentation"; const local = definePresentation; export default local({});';
    const result = lower(sourceText);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-top-level-unsupported",
          fileName: "presentation.ts",
          start: sourceText.indexOf("const local"),
          end: sourceText.indexOf("; export") + 1,
          line: 1,
          column: sourceText.indexOf("const local") + 1,
        },
      ],
    });
  });

  it("rejects the second duplicate object key at its exact range", () => {
    const sourceText = [
      'import { definePresentation } from "@unframe/presentation";',
      "export default definePresentation({ a: 1, // @ts-ignore",
      "a: 2 });",
    ].join("\n");
    const result = lower(sourceText);
    const start = sourceText.lastIndexOf("a:");
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-object-key-duplicate",
          fileName: "presentation.ts",
          start,
          end: start + 1,
          line: 3,
          column: 1,
        },
      ],
    });
  });

  it("rejects typechecked local and foreign package imports at their import ranges", () => {
    const localSource = [
      'import { definePresentation } from "@unframe/presentation";',
      'import { localValue } from "./local";',
      "export default definePresentation({ value: localValue });",
    ].join("\n");
    const local = lower(localSource, {
      files: [{ fileName: "local.ts", sourceText: "export const localValue = 1;" }],
    });
    const localStart = localSource.indexOf('import { localValue } from "./local";');
    expect(local).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-import-invalid",
          fileName: "presentation.ts",
          start: localStart,
          end: localStart + 'import { localValue } from "./local";'.length,
          line: 2,
          column: 1,
        },
      ],
    });

    const foreignSource = [
      'import { definePresentation } from "@unframe/presentation";',
      'import { foreign } from "foreign";',
      "export default definePresentation({ value: foreign });",
    ].join("\n");
    const foreign = lower(foreignSource, {
      packages: [
        {
          packageName: "foreign",
          packageVersion: "1",
          packageIntegrity: "foreign-integrity",
          files: [{ fileName: "index.ts", sourceText: "export const foreign = 1;" }],
          exports: [{ subpath: ".", targetFile: "index.ts" }],
          dependencies: [],
        },
      ],
    });
    const foreignStart = foreignSource.indexOf('import { foreign } from "foreign";');
    expect(foreign).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-import-invalid",
          fileName: "presentation.ts",
          start: foreignStart,
          end: foreignStart + 'import { foreign } from "foreign";'.length,
          line: 2,
          column: 1,
        },
      ],
    });
  });
});
