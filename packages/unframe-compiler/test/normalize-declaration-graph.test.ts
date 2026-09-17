import { describe, expect, it } from "vitest";
import { normalizeDeclarationGraph } from "../src/normalization/normalize-declaration-graph.js";
import type {
  DeclarationGraph,
  DeclarationGraphValue,
  DeclarationSourceOrigin,
} from "../src/lowering/lower-authoring-declaration.js";

const origin = (start = 0): DeclarationSourceOrigin => ({
  fileName: "presentation.ts",
  start,
  end: start + 1,
  line: 1,
  column: start + 1,
});
const literal = (value: null | boolean | number | string) => ({
  kind: "literal" as const,
  origin: origin(),
  value,
});
const object = (
  properties: readonly {
    readonly key: string;
    readonly origin: DeclarationSourceOrigin;
    readonly value: DeclarationGraphValue;
  }[],
): Extract<DeclarationGraphValue, { kind: "object" }> => ({
  kind: "object",
  origin: origin(),
  properties,
});
const call = (
  builder: string,
  arguments_: readonly DeclarationGraphValue[],
  start = 0,
): Extract<DeclarationGraphValue, { kind: "builder-call" }> => ({
  kind: "builder-call",
  builder,
  origin: origin(start),
  arguments: arguments_,
});
const graph = (value: DeclarationGraphValue): DeclarationGraph => ({
  fileName: "presentation.ts",
  root: call("definePresentation", [value]),
});

describe("normalizeDeclarationGraph", () => {
  it("materializes nested builders without executing them and maps generated fields", () => {
    const result = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "effect",
            origin: origin(2),
            value: call("setSurfaceState", [literal("surface"), literal("state")], 3),
          },
        ]),
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      rootBuilder: "definePresentation",
      value: { effect: { kind: "setSurfaceState", surfaceId: "surface", stateId: "state" } },
    });
    if (result.ok) expect(Object.getPrototypeOf(result.value)).toBe(null);
  });

  it("fails closed for reserved kind conflicts", () => {
    const result = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "value",
            origin: origin(4),
            value: call("stringProp", [
              object([{ key: "kind", origin: origin(8), value: literal("spoof") }]),
            ]),
          },
        ]),
      ),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-normalization-invalid-graph",
          fileName: "presentation.ts",
          message: "Builder fields conflict with input.",
          start: 8,
          end: 9,
          line: 1,
          column: 9,
        },
      ],
    });
  });

  it("keeps unique paths with child and property-key origins", () => {
    const valueOrigin = origin(20);
    const keyOrigin = origin(10);
    const callOrigin = origin(30);
    const result = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "nested",
            origin: keyOrigin,
            value: call("after", [{ kind: "literal", origin: valueOrigin, value: 3 }], 30),
          },
        ]),
      ),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.sourceMap).toEqual([
      { path: [], origin: expect.any(Object) },
      { path: ["nested"], origin: callOrigin, keyOrigin },
      { path: ["nested", "kind"], origin: callOrigin },
      { path: ["nested", "afterMilliseconds"], origin: valueOrigin },
    ]);
    expect(new Set(result.sourceMap.map((entry) => JSON.stringify(entry.path))).size).toBe(
      result.sourceMap.length,
    );
  });

  it("materializes every object builder and special builder without executing source definitions", () => {
    const expectedKinds = [
      ["stringProp", "string"],
      ["numberProp", "number"],
      ["booleanProp", "boolean"],
      ["slot", "slot"],
      ["part", "part"],
      ["variant", "variant"],
      ["state", "state"],
      ["action", "action"],
      ["output", "output"],
      ["invokeComponentAction", "component.action"],
      ["componentOutput", "component.output"],
      ["tokenRef", "token-ref"],
      ["namedStyleRef", "named-style-ref"],
      ["assetRef", "asset-ref"],
      ["spatial", "spatial"],
      ["frame", "frame"],
      ["text", "text"],
      ["surface", "surface"],
      ["semanticOverride", "semantic-override"],
      ["componentInstance", "component-instance"],
      ["detach", "detach"],
    ] as const;
    for (const [builder, kind] of expectedKinds) {
      const args = builder === "state" ? [] : [object([])];
      const result = normalizeDeclarationGraph(
        graph(object([{ key: builder, origin: origin(), value: call(builder, args) }])),
      );
      expect(result).toMatchObject({ ok: true, value: { [builder]: { kind } } });
    }
    for (const rootBuilder of [
      "definePresentation",
      "defineTheme",
      "defineComponentManifest",
      "defineComponentStructure",
    ]) {
      const result = normalizeDeclarationGraph({
        fileName: "presentation.ts",
        root: call(rootBuilder, [
          object([{ key: "identity", origin: origin(), value: literal(rootBuilder) }]),
        ]),
      });
      expect(result).toEqual(
        expect.objectContaining({ ok: true, rootBuilder, value: { identity: rootBuilder } }),
      );
    }
    const specialBuilders = [
      [call("state", [object([])]), { kind: "state" }],
      [call("cue", [object([{ key: "id", origin: origin(), value: literal("x") }])]), { id: "x" }],
      [
        call("surfaceState", [literal("s"), literal("st")]),
        { kind: "surfaceState", surfaceId: "s", stateId: "st" },
      ],
      [
        call("setSurfaceState", [literal("s"), literal("st")]),
        { kind: "setSurfaceState", surfaceId: "s", stateId: "st" },
      ],
      [
        call("playTimeline", [
          literal("t"),
          object([{ key: "completion", origin: origin(), value: literal("blocking") }]),
        ]),
        { kind: "playTimeline", timelineId: "t", completion: "blocking" },
      ],
      [
        call("surfaceInteraction", [literal("i")]),
        { kind: "surfaceInteraction", interactionId: "i" },
      ],
      [call("timelineCompleted", [literal("t")]), { kind: "timelineCompleted", timelineId: "t" }],
      [call("mediaCompleted", [literal("s")]), { kind: "mediaCompleted", surfaceId: "s" }],
      [call("after", [literal(1)]), { kind: "timer", afterMilliseconds: 1 }],
    ] as const;
    for (const [value, expected] of specialBuilders) {
      const result = normalizeDeclarationGraph(
        graph(object([{ key: "value", origin: origin(), value }])),
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, value: { value: expected } }));
    }
  });

  it("rejects reserved fields at each exact offending property origin", () => {
    const kind = origin(7);
    const timeline = origin(11);
    const result = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "x",
            origin: origin(),
            value: call("playTimeline", [
              literal("t"),
              object([
                { key: "timelineId", origin: timeline, value: literal("bad") },
                { key: "kind", origin: kind, value: literal("bad") },
              ]),
            ]),
          },
        ]),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.diagnostics.map(({ start }) => start)).toEqual([7, 11]);
  });

  it("rejects incorrect special shapes and malformed graphs without throwing", () => {
    const bad = [
      call("surfaceState", [literal("s")]),
      call("setSurfaceState", [literal("s"), object([])]),
      call("playTimeline", [literal("t"), literal("bad")]),
      call("surfaceInteraction", [literal(1)]),
      call("timelineCompleted", [object([])]),
      call("mediaCompleted", []),
      call("after", [literal(Number.POSITIVE_INFINITY)]),
      call("cue", [literal("bad")]),
    ];
    for (const value of bad) {
      const result = normalizeDeclarationGraph(
        graph(object([{ key: "x", origin: origin(), value }])),
      );
      expect(result).toMatchObject({ ok: false });
    }
    const invalid = [
      { fileName: "presentation.ts", root: call("definePresentation", []) },
      {
        fileName: "presentation.ts",
        root: {
          kind: "builder-call",
          builder: "definePresentation",
          origin: origin(),
          arguments: [{ kind: "unknown", origin: origin() }],
        },
      },
      graph(
        object([
          {
            key: "x",
            origin: origin(),
            value: {
              kind: "literal",
              origin: origin(),
              value: Number.NaN,
            } as DeclarationGraphValue,
          },
        ]),
      ),
      graph(
        object([
          { key: "__proto__", origin: origin(), value: literal(1) },
          { key: "__proto__", origin: origin(2), value: literal(2) },
        ]),
      ),
    ];
    for (const fixture of invalid)
      expect(() => normalizeDeclarationGraph(fixture as unknown as DeclarationGraph)).not.toThrow();
    for (const fixture of invalid)
      expect(normalizeDeclarationGraph(fixture as unknown as DeclarationGraph)).toMatchObject({
        ok: false,
      });
  });

  it("uses null-prototype objects recursively and canonical diagnostic ordering", () => {
    const result = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "z",
            origin: origin(30),
            value: {
              kind: "literal",
              origin: origin(30),
              value: Number.NaN,
            } as DeclarationGraphValue,
          },
          { key: "x", origin: origin(10), value: call("after", [], 10) },
          {
            key: "p",
            origin: origin(20),
            value: call("stringProp", [
              object([{ key: "kind", origin: origin(20), value: literal("x") }]),
            ]),
          },
        ]),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.diagnostics.map(({ start }) => start)).toEqual([10, 20, 30]);
    const good = normalizeDeclarationGraph(
      graph(
        object([
          {
            key: "nested",
            origin: origin(),
            value: object([{ key: "child", origin: origin(), value: object([]) }]),
          },
        ]),
      ),
    );
    if (!good.ok) throw new Error("expected valid graph");
    const value = good.value as {
      readonly nested: { readonly child: Record<string, unknown> };
    };
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(Object.getPrototypeOf(value.nested)).toBe(null);
    expect(Object.getPrototypeOf(value.nested.child)).toBe(null);
  });
});
