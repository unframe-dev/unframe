# Contracts

Control Plane と Realtime Backend の共有境界を置きます。

## Control Plane OpenAPI

`app/server/control-plane/src/openapi.ts` の route 定義と、それを実ハンドラへ登録する型付き
`OpenAPIHono` application が生成元です。実行時検証と文書生成は同じ Zod schema を使います。
`openapi/control-plane.openapi.json` と `src/control-plane.openapi.ts` は生成物であり、手編集しません。後者は
`@unframe/contracts/control-plane` から import できます。

```sh
pnpm --filter @unframe/contracts generate:control-plane
pnpm --filter @unframe/contracts check:control-plane
```

Control Plane の `src/openapi.ts`、共有 schema、HTTP routeを変更した場合は型を再生成し、drift checkを通してください。TypeScript runtime client は生成 path 型ではなく Hono RPC の `AppType` を使います。生成物は Unity / C# など言語非依存の契約境界として維持します。

## Presentation artifact schemas

`src/presentation/definition.ts` と `src/presentation/render-bundle.ts` の Zod 4 schema が source of
truth です。前者は renderer-independent な PresentationDefinition、後者は baked-web artifact を含む
RenderBundle の最初の serialized shape を定義します。型は同じschemaから`z.infer`で導出し、
`@unframe/contracts/presentation` からimportできます。`presentation/*.schema.json`はZodから生成する
JSON Schema Draft 2020-12 artifactであり、手編集しません。

```sh
pnpm --filter @unframe/contracts generate:presentation
pnpm --filter @unframe/contracts check:presentation
pnpm --filter @unframe/contracts test:presentation
```

`fixtures/minimal.*.v1.json` は一つの Stage、SurfaceNode、Semantic Surface、root Frame/Text、
State、baked-web intent、空 Cue の Group/Step を表す最小fixtureです。Zodと生成JSON Schemaの両方で
同じvalid/invalid結果になることを検証します。schema はportable な構造だけを検証し、ID の相互参照、ownership、State の意味的整合性、canonicalization
は `presentation-core` が担当します。これらのTarget schemaは既存Control Plane OpenAPI形式を
置き換えず、consumer migrationもまだ含みません。

最初のmilestoneではCueの詳細なTrigger / Guard / Action contractは未実装です。`cues` は
`maxItems: 0` とし、任意objectを受け入れません。Frameは`absolute` layout、Textは親Frame内の
`absolute` placementを持つ親子構造に限定します。ID参照、treeの循環、Quaternionの正規化、Scalar型とinitialValueの一致は
構造schemaの外であり、`presentation-core` が検証します。

## Realtime Protocol Buffers

`proto/unframe/realtime/v1/realtime.proto` は Realtime gRPC protocol の source of truth です。Go generated code は `app/server/realtime/internal/gen/realtime/v1/` に出力します。generated files は手で編集しません。

repository root の Nix development shell で次を実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
```

`nix run .#realtime` は生成物の drift check を含みます。C# client generation はまだ導入していません。
