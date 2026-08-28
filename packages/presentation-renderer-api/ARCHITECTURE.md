# Presentation Renderer API Architecture

- **Status**: Initial baked-web plugin contract implemented
- **Scope**: Compiler と concrete renderer の間の plugin contract
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Core Architecture](../presentation-core/ARCHITECTURE.md)

## 1. Role

現在のAPIには、一回だけ実行する `executeRendererPlugin` と、入力・plugin を own-data
snapshot へ変換する `prepareRendererBuildInput` を含む。決定性を確認するための反復実行は
conformance harnessの責務に残す。

`presentation-renderer-api` は、Compiler が renderer implementation を選択・実行するための runtime-neutral plugin boundary である。Concrete renderer の処理や自動選択 policy は持たず、入力 capability、出力 artifact、diagnostics、provenance の共通契約を定義する。

## 2. Owned contract

- renderer identifier と version
- supported Surface Render Intent と capability declaration
- structured Primitive graph / opaque renderer entry の入力 contract
- renderer build context
- raw RGBA capture、Hit Region、resolved geometry の出力 contract
- deterministic output metadata と provenance
- stable diagnostic code
- renderer fixture と conformance harness

Conceptual interface は次の責務を持つ。

```text
RendererPlugin
├─ identity and version
├─ capability negotiation
├─ support(resolvedIntent, input)
├─ build(context, input)
└─ provenance and diagnostics
```

正確な公開 TypeScript API の正本は [`src/index.ts`](./src/index.ts) とする。

## 3. Input and output boundary

入力は `presentation-core` の semantic / build model と、Compiler が解決した明示的 build context に限定する。Semantic Surface が宣言した source intent と、Compiler が renderer 選択だけを解決した resolved intent は分離する。これにより `rendererPreference: auto` を元の意味として保持したまま、選択済み renderer ID を plugin に渡せる。Renderer が project filesystem、environment variable、network を暗黙に探索しない。

公開境界は caller 所有 object を検証した後で再利用しない。`prepareRendererBuildInput` は
plain own-data descriptor から snapshot を作った後、Zod 4 schema で runtime shape を検証し、元 input の accessor、
Proxy の `get`、後続 mutation を build 実行へ持ち込まない。`executeRendererPlugin` と
conformance harness も、identity / capabilities / method reference を一度固定した plugin wrapper と
prepared input だけを `support` / `build` へ渡す。Concrete renderer が同じ境界を直接利用する場合も、
返された prepared input を以後の唯一の入力とする。

出力は encode 前の RGBA capture、Surface State ごとの normalized Hit Region、resolved geometry、diagnostics、provenance とする。Raw bytes の所有権は build result とともに caller へ移り、Renderer は返却後に buffer を変更しない。Renderer は PresentationDefinition の意味を書き換えず、Asset ID や最終 RenderBundle binding も決定しない。

## 4. Invariants

- Renderer ID / version と output provenance を Compiler の cache key と RenderBundle provenance の明示入力として渡せる。
- Compiler が選択した renderer ID と実際に呼び出した plugin identity が一致する。
- `auto` 以外の明示 renderer preference を別 renderer へ暗黙 fallback しない。
- `support` 判定と `build` 結果が同じ capability contract に従う。
- 検証した input / plugin と実行する input / plugin を同じ prepared snapshot に固定する。
- plan、Surface、完成 Semantic Tree の state 集合が完全一致する。
- Hit Region は state で有効な interaction と、それを参照する Semantic Node に結び付き、有効な interaction を漏れなく覆う。
- renderer output から Semantic Tree の意味を推測しない。
- RenderSurfaceId は build-local であり、canonical progression contract へ漏らさない。
- deterministic と宣言する plugin は同じ明示入力から同じ raw bytes、geometry、metadata を生成する。
- renderer failure は semantic model の silent fallback に変換せず、diagnostic として返す。

## 5. Non-responsibilities

- Browser lifecycle、React / CSS rendering
- texture / video encoding
- concrete artifact generation
- renderer の自動選択 policy
- Compiler pass と cache orchestration
- CLI command、publish、Delivery

## 6. Dependency rules

`presentation-renderer-api` は `presentation-core` と runtime boundary validation のための `zod` にだけ依存する。Compiler と concrete renderer が API に依存する。API から concrete renderer、Compiler、CLI への依存は禁止する。Concrete renderer 同士も依存しない。

## 7. Conformance strategy

- capability support matrix fixture
- valid / invalid build input fixture
- sparse array、accessor、Proxy、extra property、後続 mutationを含む prepared boundary fixture
- deterministic output / provenance fixture
- diagnostic code contract test
- Structured Semantic Tree を変更しないことの test
- renderer version と cache invalidation の fixture

Conformance harness は renderer implementation の process topology を固定せず、in-process / child process / remote adapter のいずれでも同じ観測可能な contract を検証できるようにする。Raw bytes は realm に依存しない `Uint8Array` view として検証し、child process / remote transport adapter は build result をこの API の型へ復元してから harness へ渡す。

## 8. Deferred decisions

- plugin discovery と version negotiation
- process / isolate boundary
- capability vocabulary
- cancellation、timeout、resource budget の API
- Native UI / Video renderer API の追加時期
- Compiler cache key と RenderBundle `environmentHash` への `rendererFingerprint` 結合、およびその integration test

## 9. Current implementation

最初の milestone は Compiler が解決した一つの Semantic Surface と Render Surface plan を、`static` / `interaction: none` / `internalAnimation: none` / `baked-web` / `reject` の Structured Frame / Text rendererへ渡す契約を実装する。

Renderer は state ごとの未 encode RGBA capture と normalized Hit Region geometry を返す。PNG encode、checksum、Asset ID、最終的な RenderBundle artifact / state binding は `presentation-assets` と Compiler が所有する。Renderer が plan、完成 Semantic Tree、入力 hash を変更することを許可しない。

`presentation-core` が generated contract から導出した read-only Surface / Semantic Tree 型を入力に使用し、この package で canonical contract を再定義しない。Renderer identity、contract version、implementation hash、明示 config hash から `rendererFingerprint` を作り、入力 context と provenance の一致を conformance harness で検査する。Compiler はこの fingerprint を cache key と `environmentHash` の入力に含める責務を持つが、Compiler 未実装の現時点では integration test も未実装であり、この API 単体は hash への包含を検証したとは主張しない。current RenderBundle schema に独立 field がないため、schema 拡張時に明示 field へ移す。

共通 conformance harness は support / build の整合、unsupported failure、malformed output、入力不変性、state / capture completeness、RGBA、Hit Region の有効性と completeness、provenance、同一入力二回の determinism を検査する。Browser process、Opaque execution、encode、cache orchestrationは含めない。

`prepareRendererBuildInput` は現行 contract の Surface、Frame / Text、State、Semantic Tree、
Render Surface plan、build context の shape を `src/validation/schemas.ts` の Zod schema で検査し、
参照関係だけを API 固有の invariant として検査する。Plugin capability、support decision、build result、
diagnostic、capture、Hit Region も同じく Zod schema を通す。各 schema の前段では dense own-data snapshot を
作るため、accessor、Proxy、sparse array、extra array property は value read 前に拒否する。plugin method は固定 receiver から呼び出す。境界通過後の renderer が
prepared input を変更した場合は `executeRendererPlugin` / conformance harness が diagnostic にする。
