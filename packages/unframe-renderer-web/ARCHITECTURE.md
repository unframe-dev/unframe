# Presentation Web Renderer Architecture

- **Status**: Presentation v2 static renderer implemented
- **Renderer ID**: `baked-web`
- **Scope**: Fixed Browser 環境での Web rendering、layout、capture
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Renderer API Architecture](../unframe-renderer-api/ARCHITECTURE.md)
  - [Assets Architecture](../unframe-assets/ARCHITECTURE.md)

## 1. Role

### Current

`unframe-renderer-web` は `baked-web` concrete renderer を実装する。Structured Component から lower された Primitive graph を、固定された Browser 環境で layout / capture し、RenderBundle 候補を生成する。

現在は `FixedBrowserAdapter` を注入する Structured 初期実装と、Opaque renderer sourceを実行せずにbundleする境界を持つ。固定 environment（Browser / font / locale / timezone / sRGB / DSF 1 / network・filesystem deny / fixed clock・random）と adapter identity を plugin 作成時に snapshot し、後続の adapter mutation を build に反映しない。

`openPlaywrightFixedBrowser` は `playwright-core@1.62.1` が managed Chromium headless shell を選択して起動し、外部 binary path / fallback を持たない。`install chromium --only-shell` と headless 起動を対応させるため、adapterはPlaywrightのmanaged browser registryに起動先の選択を委譲する。Chromium sandbox 有効、Node global signal handler 無効で起動し、Noto Sans CJK JP、`ja-JP`、`Asia/Tokyo`、DSF 1、sRGB、2000-01-01T00:00:00Z、seed `0x5eed` を固定する。font fingerprint は固定glyph baselineの実capture RGBAから内部導出し、adapter identity hash に font profile とともに結合する。capture ごとに隔離 context を作成し、offline、service worker block、download deny、全 route abort、clock / random init、font ready の後に CSS scale、背景保持、animation無効、caret非表示の PNG screenshot を decode して所有済み RGBA として返す。capture trust boundary は各辺4096px・総16,777,216pxまでで fail closed とし、これはCompiler の ADR-0012 2K artifact policyとは別の入力上限である。abort または session close は進行中 context を閉じ、context cleanup 後に browser を閉じる。通常 check は `*.integration.test.ts` を除外してこの adapter を fake で検証する unit test だけを実行し、browser binary の provision / 実機 integration は明示 script の後にのみ実行する。

M1のfixed script environmentはcall / construct両方の`Date`、`performance.now` / `timeOrigin`、`Math.random`、`crypto.getRandomValues` / `randomUUID`を固定する。deterministicな鍵生成や暗号乱数の意味を仮実装しないため`crypto.subtle`は拒否する。Opaque renderer execution自体は引き続きDeferredである。

Structured path は Presentation v2 の absolute root `Frame` と、任意深度の absolute `Frame` / literal `Text` tree を deterministic な HTML/CSS に lower する。各 Frame の placement、background、border、clip、visible、opacity と、Text の全 style field を反映し、Frame の children 順と親相対座標を維持する。logical bounds は Compiler が渡した pixel target へ明示的に scaleし、color scheme も Browser media emulation input として渡す。DOM から semantic を推測しない。State visual variation、Interaction、Stack / Grid と他のPrimitiveはfail closedにする。Theme / Props / Slots / Variants / Parts は Compiler が concrete tree へ解決し、renderer は Authoring 宣言を再解決しない。

renderer config は CSS やfont familyを受け取らず、document backgroundの`[r, g, b, a]` 0–255 byteだけを持つ。Fontは入力`fontAssets`のcanonical base64、SHA-256、TTF/OTF signature、Unicode `cmap` format 4/12を検証し、全literal code pointがprimaryまたは明示fallbackのglyphへ解決できる場合だけdata URIの`@font-face`を生成する。Browser adapterは全faceの`FontFace.load()`と`document.fonts.ready`を待ち、失敗をcapture failureにする。CSS family列にhost fontやgeneric familyを追加しない。

build は Renderer API が prepared snapshot として返した input だけを以後の処理に使用し、呼出元の input object を再読しない。

Adapter から返る raw capture は requested pixel size の sRGB `opaque` または `straight` RGBA に限定する。renderer は RGBA bytes と pixel size をコピーして ownership を引き受け、`premultiplied` は Assets encoder と互換しないため拒否する。

Web technology は build-time renderer implementation であり、Control Plane や Unity Runtime に HTML、CSS、React、JavaScript を配信して実行させるものではない。

Compiler が決定した Render Surface partition を build input として受け取り、その geometry と artifact を解決する。renderer が Component graph を再分割したり partition policy を選択したりしない。

### Target / Deferred

設計上は renderer が `unframe-core` と `unframe-assets` を直接利用する target である。一方、現在は Renderer API の型境界だけに直接依存し、Core validation・Assets encode は Compiler 経由で行う。

## 2. Owned pipeline

### Current

- injected `FixedBrowserAdapter` の identity / fixed environment を snapshot した Structured build
- absolute root `Frame` と任意深度の absolute `Frame` / literal `Text` tree の HTML/CSS lower、state capture、raw RGBA ownership transfer
- locked virtual packageからのOpaque TS/TSX/JS/JSX/JSON bundleとCSS/asset emit
- Compilerが入力を検証し、現行subsetではSemantic Surface全体を一partitionにして、`unframe-assets`へのencode / checksum委譲とRenderBundle組立を行う

### Target

- generic Web renderer による Structured Primitive graph の描画
- Opaque renderer TS / React / CSS の isolated execution
- Opaque renderer向けのBrowser isolate lifecycle
- Surface State ごとの layout と capture
- Hit Region の concrete geometry 解決
- unencoded Surface capture の生成
- Browser、font、locale、timezone、viewport、layout provenance
- visual regression fixture

### Deferred

- Opaque execution と interaction geometry

```text
resolved semantic input + renderer source
                 ↓
          isolated Browser render
                 ↓
 layout / hit-region geometry / raw capture
                 ↓
   unframe-assets encode and checksum
                 ↓
       RenderBundle artifact candidate
```

## 3. Structured and opaque paths

### Current

Structured path は absolute root `Frame` と、その子孫となる absolute `Frame` / literal `Text` を扱う。semantic tree の意味は入力として比較するだけで DOM から推測しない。Opaque sourceのbundle APIは実装済みだがBrowser execution/captureとは未接続であり、Renderer pluginの`support()`はOpaque entryを引き続き拒否する。

### Target

Structured path は Primitive graph を generic renderer で描画する。Component 固有 React / CSS を参照せず、Structure に宣言されていない semantics を追加しない。

Opaque path は Component 固有 renderer entry を bundle / execute できる。ただし、Semantic Tree、State、Interaction、Action、Output の意味は Manifest から受け取り、DOM や実行結果から推測しない。Renderer binding key と resolved element geometry の対応だけを解決する。

### Deferred

Opaque Browser executionとReact/CSS runtime isolation、Frame/Text 以外の Primitive と state visual variation の lower は未実装である。

## 4. Invariants

- Browser version、font、locale、timezone、viewport、device scale、color space を provenance に固定する。
- network、clock、randomness、host filesystem などの capability は既定で許可せず、許可時は入力と provenance に含める。
- State ごとの capture と Hit Region geometry は同じ layout result から生成する。
- 一つの Render Surface の集合、bounds、layer は全 reachable State で共通とし、各 State に artifact または明示的な empty binding を持たせる。
- semantic information が Manifest / Structure と一致しない場合は build error とする。
- raw capture の resize、encode、checksum は `unframe-assets` に委譲する。
- PresentationDefinition の意味と Surface partition policy を変更しない。

## 5. Non-responsibilities

- PresentationDefinition の semantic validation
- Component Manifest から宣言されていない意味の推測
- Structured Component 固有 React / CSS implementation
- Surface partition と renderer 自動選択 policy
- Asset upload、Signed URL、Unity renderer
- Native UI / Video renderer の仮実装

## 6. Dependency rules

`unframe-renderer-web` は `unframe-renderer-api`、hash utility、Zod 4、固定versionの`rolldown`、`playwright-core`、`pngjs`に直接依存する。Playwrightはmanaged headless shellのhost lifecycleだけ、pngjsはpreflight済みscreenshotのRGBA decodeだけを担当する。font fingerprintはcaller入力ではなく固定Noto glyph baselineのactual RGBA bytesから導出する。ZodはOpaque locked module input、renderer config、Browser identity / environment、capture metadataのruntime validationを所有する。Opaque source bundleはRolldownのprogrammatic APIと固定内部pluginだけを使用し、callerから任意pluginを受け取らない。raw RGBA encode / checksum は Compiler 経由で `unframe-assets` に委譲し、`unframe-core` は Renderer API の型境界を通して参照する。Compiler から plugin として注入され、Compiler へ逆依存しない。他の concrete renderer にも依存しない。

## 7. Isolation boundary

### Current

Adapter とOpaque bundle inputのown data descriptorをproperty value accessなしでsnapshotし、後続mutationやaccessorをbuild inputに混入させない。hostile objectをZodへ直接渡さず、descriptor検査から再構築したplain-data snapshotだけを渡すことで、Zodのproperty readによるgetter実行を防ぐ。Zodはsnapshot後のstrict object、tuple、enum、文字列制約、module path / type整合、entry / module集合の関係を検証する。

### Target / Deferred

Browser process / isolate は semantic Compiler process と分離可能な adapter とする。Opaque code の failure、timeout、resource exhaustion を renderer diagnostic へ変換し、Compiler host を暗黙に汚染しない。

Capability はallowlistとする。現行bundle境界はlocked virtual package内の相対module、`react`、`react/jsx-runtime`、固定`@unframe/renderer-runtime`、package内CSS/assetsだけを許可する。`node:*`、絶対path、network import、任意bare import、`react-dom`、`node_modules`、PostCSS/Tailwind/Vite/Rolldown config、caller pluginは拒否する。React DOMは将来のBrowser hostが所有する。Embedded Browser runtimeを生成する機能は持たない。

## 8. Validation strategy

### Current

- Renderer API conformance、fixed adapter / config / environment / fingerprint の境界テスト
- HTML/CSS golden、state order、capture ownership、hostile output / direct build input の回帰テスト
- Zod schemaによるconfig / environment / capture metadataとOpaque module inputのvalidation test
- Opaque module/asset bundle、field path diagnostic、accessor非実行、capability denyの境界テスト

### Target

- generic Primitive renderer の conformance fixture
- Surface State ごとの visual regression
- Semantic Tree / Hit Region binding の completeness test
- fixed environment の reproducibility test
- Opaque capability deny / timeout / failure test
- renderer / font / locale 変更時の cache invalidation test
- raw capture と encoded artifact descriptor の integration test

### Deferred

- real Browser visual regression baseline、Opaque timeout / resource budget、Assets との end-to-end artifact test

## 9. Deferred decisions

- Opaque bundleとRenderer plugin/Browser isolateの接続
- ADR-0011で確定したmulti-partition plan / private region aggregateの実装
- ADR-0012で確定した2K capture resolution / capture budgetの実装
- visual regression tolerance と platform baseline
- Frame/Text 以外の Structured Primitive、Stack / Grid、state variation、interaction Hit Region
