# Presentation Web Renderer Architecture

- **Status**: Proposal / Target, not implemented
- **Renderer ID**: `baked-web`
- **Scope**: Fixed Browser 環境での Web rendering、layout、capture
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Renderer API Architecture](../presentation-renderer-api/ARCHITECTURE.md)
  - [Assets Architecture](../presentation-assets/ARCHITECTURE.md)

## 1. Role

`presentation-renderer-web` は `baked-web` concrete renderer を実装する。Structured Component から lower された Primitive graph、または Opaque Component の Web renderer entry を、固定された Browser 環境で layout / capture し、RenderBundle 候補を生成する。

Web technology は build-time renderer implementation であり、Control Plane や Unity Runtime に HTML、CSS、React、JavaScript を配信して実行させるものではない。

Compiler が決定した Render Surface partition を build input として受け取り、その geometry と artifact を解決する。renderer が Component graph を再分割したり partition policy を選択したりしない。

## 2. Owned pipeline

- generic Web renderer による Structured Primitive graph の描画
- Opaque renderer TS / React / CSS の isolated execution
- Browser lifecycle と fixed rendering environment
- Surface State ごとの layout と capture
- Hit Region の concrete geometry 解決
- unencoded Surface capture の生成
- Browser、font、locale、timezone、viewport、layout provenance
- visual regression fixture

```text
resolved semantic input + renderer source
                 ↓
          isolated Browser render
                 ↓
 layout / hit-region geometry / raw capture
                 ↓
   presentation-assets encode and checksum
                 ↓
       RenderBundle artifact candidate
```

## 3. Structured and opaque paths

Structured path は Primitive graph を generic renderer で描画する。Component 固有 React / CSS を参照せず、Structure に宣言されていない semantics を追加しない。

Opaque path は Component 固有 renderer entry を bundle / execute できる。ただし、Semantic Tree、State、Interaction、Action、Output の意味は Manifest から受け取り、DOM や実行結果から推測しない。Renderer binding key と resolved element geometry の対応だけを解決する。

## 4. Invariants

- Browser version、font、locale、timezone、viewport、device scale、color space を provenance に固定する。
- network、clock、randomness、host filesystem などの capability は既定で許可せず、許可時は入力と provenance に含める。
- State ごとの capture と Hit Region geometry は同じ layout result から生成する。
- 一つの Render Surface の集合、bounds、layer は全 reachable State で共通とし、各 State に artifact または明示的な empty binding を持たせる。
- semantic information が Manifest / Structure と一致しない場合は build error とする。
- raw capture の resize、encode、checksum は `presentation-assets` に委譲する。
- PresentationDefinition の意味と Surface partition policy を変更しない。

## 5. Non-responsibilities

- PresentationDefinition の semantic validation
- Component Manifest から宣言されていない意味の推測
- Structured Component 固有 React / CSS implementation
- Surface partition と renderer 自動選択 policy
- Asset upload、Signed URL、Unity renderer
- Native UI / Video renderer の仮実装

## 6. Dependency rules

`presentation-renderer-web` は `presentation-core`、`presentation-renderer-api`、`presentation-assets` に依存する。Compiler から plugin として注入され、Compiler へ逆依存しない。他の concrete renderer にも依存しない。

## 7. Isolation boundary

Browser process / isolate は semantic Compiler process と分離可能な adapter とする。Opaque code の failure、timeout、resource exhaustion を renderer diagnostic へ変換し、Compiler host を暗黙に汚染しない。

Capability は allowlist とし、module resolution と package lock を build input に含める。Embedded Browser runtime を生成する機能は持たない。

## 8. Validation strategy

- generic Primitive renderer の conformance fixture
- Surface State ごとの visual regression
- Semantic Tree / Hit Region binding の completeness test
- fixed environment の reproducibility test
- Opaque capability deny / timeout / failure test
- renderer / font / locale 変更時の cache invalidation test
- raw capture と encoded artifact descriptor の integration test

## 9. Deferred decisions

- Browser process / isolate の具体方式
- Opaque renderer capability と module resolution
- Surface partition の author override
- capture resolution、GPU / RAM budget
- visual regression tolerance と platform baseline
