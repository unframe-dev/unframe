# Presentation Assets Architecture

- **Status**: Memory-only RGBA resize and PNG encoder implemented
- **Scope**: Compiler build 中の deterministic asset transformation
- **Related**:
  - [Presentation Architecture](../../docs/packages/ARCHITECTURE.md)
  - [Presentation Implementation Design](../../docs/packages/DESIGN.md)
  - [Presentation Core Architecture](../unframe-core/ARCHITECTURE.md)
  - [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md)

## 1. Role

`PNG_ENCODER_IDENTITY`は現在のmemory-only encoderの凍結された公開provenance identity
である。cacheとdelivery bindingはこのpackageの責務外である。

`unframe-assets` は、入力 Asset と renderer capture を content-addressed な build artifact へ変換する library boundary である。OS tool、codec、font processor などの environment-dependent implementation を semantic core から隔離し、変換条件と provenance を明示する。

Asset の upload、ownership、delivery URL、Unity runtime cache はこの package の責務ではない。

## 2. Owned pipeline

現在は memory-only RGBA resize、PNG encode、checksum、portable descriptor と固定 provenance を所有する。Baked Web v1 の format、resolution、byte式、aggregate budget は [ADR-0012](../../docs/decisions/0012-texture-budget-residency-contract.md) に従う。Compiler は pixelTarget で直接 capture するため、通常 build は resize を行わず PNG encode だけを呼ぶ。

font subset、video / model 変換と、それらに必要な temporary workspace は具体 consumer 確定後の adapter に残す。mipmap / GPU compression は v1 の対象外である。cache storage は Compiler / CLI、upload / Delivery は別の所有境界とする。

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
- Renderer は partition の描画と capture、Compiler は Surface 全体の Hit Region geometry を所有する。この package は capture 後の binary 変換だけを所有する。
- Semantic Tree の意味を image、DOM、font output から抽出しない。

## 5. Non-responsibilities

- Component / Surface semantics
- Browser layout と capture
- renderer selection と plugin orchestration
- Control Plane の Asset ownership、R2 upload、Signed URL
- Unity runtime download、preload、eviction
- presentation publication policy

## 6. Dependency rules

`unframe-assets` は artifact descriptor と diagnostic の型に限って `unframe-core` へ依存できる。Renderer API、Compiler、concrete renderer、Control Plane へ依存しない。

入力 request、limit、pixel size、color space、alpha mode は Zod 4 schema で検証する。schema に渡す前に request を一度 snapshot し、hostile property access は stable diagnostic へ変換する。PNG plan の byte arithmetic、absolute / caller budget、RGBA length、opaque alpha byte列の走査は format 固有の algorithmic invariant なので手書きで保持する。

外部 executable / codec を adapter 内に閉じ込め、public model や Core に process-specific 型を露出しない。

## 7. Validation strategy

- same-input / same-output hash の determinism test
- image dimensions、alpha、color space、mipmap の golden fixture
- font subset と glyph coverage fixture
- invalid media、tool failure、cancel、cleanup の test
- descriptor と binary checksum の consistency test
- toolchain provenance 変更時の cache invalidation test

## 8. Current implementation

Memory-only の `resizeRgba` と `encodeRgbaToPng` を公開する。入力は source ID、sRGB RGBA8 bytes、pixel size、alpha mode と caller budget であり、resize は明示的な target pixel size を追加で受け取る。filesystem path、process environment、renderer固有型を含まない。

Resize は縮小時に各 target pixel の source 上の矩形 footprint と source pixel の重なり面積で平均し、拡大時に pixel center に揃えた線形補間を使う。各 channel は sRGB から linear light に変換し、alpha を掛けてから合成し、出力時に alpha で割って sRGB8 へ戻す。alpha が 0 に丸められる場合は RGB も 0 にする。出力RGBAは新規bufferとし、source/output byte列の SHA-256 checksum、resize identity、source ID、target sizeを返す。

PNG byte列は 8-bit RGBA / non-interlaceのIHDR、sRGB rendering intent 0、各scanlineのfilter 0、`78 01` zlib headerと最大65,535 byteのstored DEFLATE block、Adler-32、CRC32、IENDに固定する。timestampや可変metadataを持たず、native codecやOS toolへ依存しない。同じ入力は同じbyte列になるが、圧縮率は最適化しない。

Encoderは検証時に最終byte数を計画し、入力RGBAとは別の単一output bufferへPNGを直接書き込む。scanline全体、DEFLATE block列、chunk列の中間copyは作らず、最大時の主要working setをcaller-owned inputとencoder-owned outputに限定する。

PNGがunassociated alphaを表すため、`opaque`は全alpha channelが255であることを検証し、`straight`をそのまま保持する。`premultiplied`は丸めを伴う変換規則が未定義なのでstable diagnosticで拒否する。

Callerはwidth、height、pixel数、input byte数、output byte数の上限を明示する。さらにpackage trust boundaryとして4,096 x 4,096、16,777,216 pixels、64 MiB input、65 MiB outputの絶対上限を超えられない。これはGPUやDeliveryの品質budgetではなく、未trusted inputによる過大allocationを防ぐ初期上限である。

最終PNG bytesのchecksumをlowercase hexの`sha256:<digest>`とし、derived `assetId`にも同じ値を使う。v2 `TextureArtifact` descriptorにはencoded byte数、`mipCount: 1`、RGBA8の`gpuBytes = 4 * width * height`も格納する。source ID、derived ID、Compiler cache keyは別概念であり、encoder version / fingerprintはprovenanceとして返す。

返却された`bytes`はcallerが所有し、別のencode結果や入力bufferとは共有しない。callerはchecksum検証後のbytesを変更できるが、descriptor/checksumを永続化または後段へ渡した後は変更してはならない。mutable/untrustedなbytesを受け取る永続化・Delivery境界はdescriptorのchecksumを再検証する。

mipmap、temporary workspace、font / video / model変換、cache、Surface State binding、RenderBundle組み立て、upload / Deliveryは実装しない。

## 9. Deferred decisions

- 新しい consumer が必要とする texture format / resolution policy（現行 v1 policy は Compiler / Core に実装済み）
- font resolver と subset toolchain
- video / model adapter の初期範囲
- cross-platform reproducibility と container / Nix boundary
