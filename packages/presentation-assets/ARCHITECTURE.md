# Presentation Assets Architecture

- **Status**: Proposal / Target, not implemented
- **Scope**: Compiler build 中の deterministic asset transformation
- **Related**:
  - [Presentation Architecture](../../docs/presentation/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/presentation/DESIGN.md)
  - [Presentation Core Architecture](../presentation-core/ARCHITECTURE.md)

## 1. Role

`presentation-assets` は、入力 Asset と renderer capture を content-addressed な build artifact へ変換する library boundary である。OS tool、codec、font processor などの environment-dependent implementation を semantic core から隔離し、変換条件と provenance を明示する。

Asset の upload、ownership、delivery URL、Unity runtime cache はこの package の責務ではない。

## 2. Owned pipeline

次は変換 adapter の ownership 候補であり、対応 format、budget、既定値が確定済みであることを意味しない。

- image / renderer capture の resize
- texture encode、mipmap、checksum
- font resolution と必要な場合の subset
- video / model transformer を追加する adapter boundary
- content-addressed binary output
- media type、dimensions、size、checksum、encoder provenance
- temporary workspace と output cleanup の library boundary

```text
declared input + transform request + toolchain provenance
                         ↓
                 deterministic transform
                         ↓
             binary + descriptor + diagnostics
```

## 3. Input and output boundary

入力は content、declared media type、変換 request、明示された toolchain / environment configuration とする。Source path や process current directory は identity に使用しない。

出力 descriptor は RenderBundle が参照できる portable metadata とし、Signed URL、R2 object key、Unity cache path を含めない。

## 4. Invariants

- binary identity は content と変換条件から決まり、作業 directory に依存しない。
- checksum、media type、size、encoder provenance を出力に含める。
- temporary output は成功・失敗・cancel のいずれでも cleanup できる。
- source Asset と derived artifact の対応を追跡できる。
- renderer capture の layout / Hit Region geometry は renderer が所有し、この package は capture 後の binary 変換だけを所有する。
- Semantic Tree の意味を image、DOM、font output から抽出しない。

## 5. Non-responsibilities

- Component / Surface semantics
- Browser layout と capture
- renderer selection と plugin orchestration
- Control Plane の Asset ownership、R2 upload、Signed URL
- Unity runtime download、preload、eviction
- presentation publication policy

## 6. Dependency rules

`presentation-assets` は artifact descriptor と diagnostic の型に限って `presentation-core` へ依存できる。Renderer API、Compiler、concrete renderer、Control Plane へ依存しない。

外部 executable / codec を adapter 内に閉じ込め、public model や Core に process-specific 型を露出しない。

## 7. Validation strategy

- same-input / same-output hash の determinism test
- image dimensions、alpha、color space、mipmap の golden fixture
- font subset と glyph coverage fixture
- invalid media、tool failure、cancel、cleanup の test
- descriptor と binary checksum の consistency test
- toolchain provenance 変更時の cache invalidation test

## 8. Deferred decisions

- texture format、resolution、mipmap、compression budget
- font resolver と subset toolchain
- video / model adapter の初期範囲
- cross-platform reproducibility と container / Nix boundary
