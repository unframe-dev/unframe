# ADR-0012: Texture build budget と runtime residency を固定する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0006](0006-presentation-rendering-strategy.md), [ADR-0010](0010-spatial-surface-coordinate-contract.md), [ADR-0011](0011-surface-partition-contract.md), [Presentation Architecture](../presentation/ARCHITECTURE.md)

## Context

現行`presentation-assets`は一回のPNG encodeに4,096 x 4,096、16,777,216 pixels、64 MiB input、65 MiB outputのtrust-boundary hard capを持つ。しかしCompilerはcapture前に全体budgetを検査せず、State数、Render Surface数、capture RGBA、保持するencoded output、Delivery選択、Unity residencyを制限していない。このper-encode capは未trusted inputによる単一allocation防止であり、Presentationの品質・build・device budgetではない。

ArchitectureはTexture dimension / format / mipmap / GPU / RAM budget tierをCapability Profileに持たせる一方、exact resolution、State artifact数、decoded memory、crossfade peak、preload readiness、active pin / evictionを未定義としていた。本ADRはM2 item 6として保守的なBaked Web v1 contractを固定する。M2では文書だけをAcceptedにし、schema / Compiler / Delivery / Realtime cache / Unity Asset ManagerはM3〜M5で同じ変更系列として実装する。

## Decision

### v1 scope と単位

v1 texture pathはBaked Webのdeterministic PNG transportとUnity `RGBA32` uploadだけを対象にする。Native UIは本ADRのtexture count / bytesへ課金せず、Font / glyph / Node limitを別artifact contractで検証する。Videoはdecoder surface / buffer / codecごとのbudget contractがないためv1 Deliveryでfail closedとし、texture式へ推測して混ぜない。

すべてのcountはnon-negative integer、byte値は`UInt64`、dimension / per-texture pixel / State countは`UInt32`、複数textureを加算するaggregate pixel countは`UInt64`とする。`1 MiB = 1,048,576 bytes`であり、MB表記やprocess RSSの概算をportable contractへ使用しない。加算・乗算はunsigned 64-bit checked arithmeticで行い、overflow自体をbudget超過として拒否する。

### Resolution と State artifact count

各non-empty `(RenderSurfaceId, SurfaceStateId)`はexactly one `TextureArtifactV1`を持つ。`textures` arrayの長さは1、empty bindingはtextureを持たない。異なるStateのbytesが同じでもState coverageは別々に検証し、verified `checksum`が同じbinaryだけをstorage / residencyでdeduplicateする。`assetId`はBundle内の論理識別子であり、同じ`assetId`が異なるchecksum、size、media type、pixel metadataを指すBundleは`asset-descriptor-conflict`で拒否する。

v1のresolution policyは`longEdgePixels = 2_048`の一種類だけである。Render Surface logical boundsを`bw, bh`とし、次でpixel sizeを導出する。

```text
scale = 2_048 / max(bw, bh)
pixelWidth  = max(1, floor(bw * scale + 0.5))
pixelHeight = max(1, floor(bh * scale + 0.5))
```

結果は各dimension `1..2_048`、総pixel数`1..4_194_304`でなければならない。author / renderer / Deliveryは任意pixel size、device別resize、別aspect、解像度variantを追加しない。resolution policy versionと導出結果をbuild configuration / provenanceへ含める。将来複数resolutionを追加する場合はartifact候補順、build budget、profile selectionを新versionで同時に更新し、v1へoptional fallbackとして混在させない。

一buildの構造上限は次とする。

| Limit                                | v1 value |
| ------------------------------------ | -------: |
| reachable States / Render Surface    |       16 |
| Render Surfaces / Semantic Surface   |       16 |
| Render Surfaces / RenderBundle       |       64 |
| non-empty texture State bindings     |      256 |
| texture variants / non-empty binding |        1 |

同じchecksumへdeduplicateできても、capture workを必要とするnon-empty binding countとrendered pixelsはdeduplicate前に課金する。上限回避のためStateやpartitionを同一Assetへaliasしない。

### Texture format、mipmap、byte formula

`TextureArtifactV1`は次のportable metadataを持つ。

```ts
type TextureArtifactV1 = {
  assetId: AssetId;
  mediaType: "image/png";
  encodedSizeBytes: UInt64;
  pixelSize: readonly [width: UInt32, height: UInt32];
  pixelFormat: "rgba8-unorm-srgb";
  mipCount: 1;
  checksum: ContentHash;
  colorSpace: "srgb";
  alphaMode: "opaque" | "straight";
  decodedGpuBytes: UInt64;
  peakLoadCpuBytes: UInt64;
  memoryEstimateVersion: 1;
};
```

PNGは現行encoder version 1の8-bit RGBA、sRGB chunk、filter 0、stored DEFLATEを使う。`premultiplied`はportable schemaでも拒否し、暗黙unpremultiplyを行わない。mipmap、runtime GPU compression、platform transcode、lossy compression、texture streamingはv1に含めない。Unityはmip chainなしの`RGBA32`としてloadし、upload後にCPU readback copyを破棄する。

widthを`w`、heightを`h`、`P = w * h`、`S = h * (4w + 1)`、`B = ceil(S / 65_535)`とすると、portable chargeは次である。

```text
rawRgbaBytes      = 4 * P
encodedSizeBytes  = 76 + S + 5 * B
decodedGpuBytes   = rawRgbaBytes
peakLoadCpuBytes  = encodedSizeBytes + 2 * rawRgbaBytes
```

`encodedSizeBytes`はencoderがallocation前に予測した値と実bytes lengthの両方に一致しなければならない。`peakLoadCpuBytes`はmanaged encoded buffer、decoded RGBA、upload stagingを各一つ課金するportable admission chargeであり、Unity process全体の実測RSSを表さない。implementationは一textureずつserialにdecode / uploadし、追加copyを恒常保持しない。platform / driver overheadはQuest実機profileで別途観測し、このcanonical chargeを暗黙補正しない。

Unity公式文書ではRGBA32は32 bits / pixel、mipmapはmemoryを約33%増やし、CPU readable copyはupload後に破棄できる。本ADRは近似の`4/3`を使わず、v1を`mipCount = 1`へ固定する。

- [Unity GPU texture formats](https://docs.unity3d.com/ja/6000.0/Manual/texture-formats-reference.html)
- [Unity mipmaps introduction](https://docs.unity3d.com/ja/2023.2/Manual/texture-mipmaps-introduction.html)
- [Unity Texture2D.Apply](https://docs.unity3d.com/2023.1/Documentation/ScriptReference/Texture2D.Apply.html)

### Compiler build budget

v1 default build policyは次を持つ。callerは小さくできるが大きくできない。resolution policy version、budget policy version、long edge、State / Surface / binding count、`maxTextureWidth`から`maxBuildAccountedPeakBytes`までのdeterministic count / byte field、renderer concurrencyの正規化済み実値を`NormalizedTextureBuildPolicyV1`としてRenderBundle `buildContext.textureBuildPolicy`へ記録する。`policyHash` field自身を除いたcanonical policy payloadのhashを`policyHash`へ格納し、build hash / provenance / Compiler cache keyへ含める。wall-time、host RSS、abortは同じ入力のartifact identityを変えないavailability guardとしてhashへ含めない。

| Field                              | v1 hard maximum |
| ---------------------------------- | --------------: |
| `maxTextureWidth`                  |           2,048 |
| `maxTextureHeight`                 |           2,048 |
| `maxTexturePixels`                 |       4,194,304 |
| `maxRenderedPixels`                |      67,108,864 |
| `maxSurfaceCaptureBytes`           |     268,435,456 |
| `maxBuildOutputBytes`              |     268,435,456 |
| `maxBuildAccountedPeakBytes`       |     536,870,912 |
| `maxBuildHostRssBytes`             |   1,073,741,824 |
| `maxRendererSurfaceWallTimeMillis` |          30,000 |
| `maxBuildWallTimeMillis`           |         600,000 |
| renderer concurrency               |               1 |

renderer concurrency 1はcapture / encode working setのaccounting前提であり、並列化する場合は新budget policy versionでpeak式を更新する。

Compilerはrendererを呼ぶ前にState / partition count、derived pixel dimensions、`sum(rawRgbaBytes)`、既知の構造上限をpreflightする。各surface renderer resultを受けた後、encode前にcapture bytesを再検証する。PNG plan後にunique verified `checksum`単位のoutputを加算し、次をchecked arithmeticで検証する。

```text
renderedPixels = sum(non-empty binding before dedup, w * h)
surfaceCaptureBytes = sum(current Render Surface captures, rawRgbaBytes)
buildOutputBytes = sum(unique output checksum, encodedSizeBytes)
buildAccountedPeakBytes =
  retained unique-checksum buildOutputBytes
  + current surfaceCaptureBytes
  + current encode encodedSizeBytes
```

renderer / encodeは一Render Surfaceずつ実行し、次へ進む前にcaptureを解放する。Compiler APIは失敗時にpartial RenderBundle / Asset Setを返さず、CLIは将来temporary workspaceをcleanupして成功時だけatomic renameする。deterministic count / byte budgetはCompiler、format固有byte planは`presentation-assets`、wall-time / abort / process-tree RSS hard killはRenderer isolated hostが所有する。`maxBuildHostRssBytes`はCompilerとそのBrowser / codec child process treeのresident set合計をhostが観測するavailability guardであり、portable memory estimateやoutput identityには含めない。超過時はprocess treeを終了して`renderer-resource-exceeded`とし、partial outputをpublishしない。

### Delivery budget tier

normalized Capability Profileは少なくとも次を持つ。

```ts
type TextureBudgetTierV1 = {
  id: "texture-baseline-v1";
  supportedRendererKinds: readonly ["baked-web"];
  maxTextureWidth: 2_048;
  maxTextureHeight: 2_048;
  maxTextureGpuBytes: 268_435_456;
  maxTextureLoadCpuBytes: 268_435_456;
  supportedPixelFormats: readonly ["rgba8-unorm-srgb"];
  supportedMipCounts: readonly [1];
};
```

DeliveryはADR-0011のordered `artifactIds`を変えず、visibleな全reachable Stateの各non-empty bindingから最初のcompatible artifactを一つ固定する。`texture-baseline-v1`は`baked-web`だけを許可し、Native UI / Videoを含むprofileはrenderer固有budget tierがAcceptedになるまで`delivery-artifact-unavailable`で拒否する。v1では候補が一つなので、不適合ならfallbackせずrejectする。GPU chargeはselected textureのunique verified `checksum`ごとに`decodedGpuBytes`を一回、CPU chargeはserial loaderの最大`peakLoadCpuBytes`を一回数える。同じchecksumを持つdescriptorのencoded / decoded size、media type、pixel metadataが一致しなければ`asset-descriptor-conflict`で拒否する。次を両方満たさなければDeliveryManifest全体を`delivery-texture-budget-exceeded`でatomicに拒否する。

```text
sum(unique selected checksum, decodedGpuBytes) <= maxTextureGpuBytes
max(selected texture peakLoadCpuBytes) <= maxTextureLoadCpuBytes
```

Manifestの`assetAccess`はselected Assetの`mediaType` / `encodedSizeBytes`を、`textureResidency`はselected textureのpixel metadata、memory estimate、budget tier IDを運ぶ。Control PlaneはRenderBundle metadataと実Asset size / checksumを照合し、client申告値からtierを拡張しない。UnityはManifest内のdescriptor一致とbudgetを再検証する。`Texture.currentTextureMemory` / `targetTextureMemory`は観測値としてtelemetryに使えるが、Manifest admissionの正本にしない。

### Preload、readiness、crossfade

v1はvisibleな全reachable Stateのselected textureをsession開始前にdownload、size / media type / checksum検証、serial decode、GPU uploadし、CPU readback copyを破棄する。readinessを次の段階に分ける。

1. `downloadReady`: 全selected encoded Assetがlocal cacheにあり検証済み。
2. `residentReady`: 全selected textureがManifest metadataどおりGPU residentで、CPU readback copyが破棄済み。
3. `sessionReady`: required Control / State connectionとfenceが揃い、`residentReady`である。

participantは`sessionReady`前にSession開始条件のready集合へ数えない。Sessionが全participantを待つか必須roleだけを待つかは既存の明示start policyに従い、texture loaderがpolicyを変更しない。active session中はselected texture hashを全てpinし、State change / crossfade中にevictしない。したがって一つのSemantic Surfaceで同時に一transitionだけというADR-0007 / Architectureの規則に対し、old / new Stateの二重residencyは上記GPU sumへすでに含まれ、transition開始時の追加allocationを行わない。resident不足時にcrossfadeをcutへ変換したりcanonical stateをclientだけで戻したりしない。

開始前のdownload / decode / upload失敗、metadata不一致、device allocation失敗はtyped resource failureとしてparticipant readinessをrejectする。別resolution、別renderer、別State artifactへ暗黙fallbackしない。開始後にdevice context lossなどでpinned residencyを失ったclientは描画とinput送信を停止し、Control / State connectionを`asset_residency_lost` reasonで閉じる。Runtimeは通常のparticipant disconnectとしてpresenceと既存Presenter lease policyを適用し、asset layerからcanonical progressionやSession pauseを直接変更しない。他participantのSessionは継続する。

### Cache と eviction

encoded Asset cacheはGPU residencyと別budgetにし、verified checksumをcache keyにする。baseline Edge / Unity cache policyはhard limit 4 GiB、filesystem low-space reserve 512 MiBとする。cache cleanup後のverified file合計を`currentVerifiedBytes`、既存staging fileの実bytesを`currentStagingBytes`、commit済みdownload reservationのうちまだfilesystemへ書かれていないbytesを`currentReservedRemainingBytes`、selected Assetのうちcacheにも既存reservationにもないunique checksumのbytesを`requiredNewBytes`、unpinned LRUからevictするbytesを`evictedBytes`、admission直前の実filesystem free bytesを`freeBytes`とする。checked arithmeticで次を両方満たすまでevictし、満たせなければ`asset-cache-admission-exceeded`でSession readinessをrejectする。

```text
currentVerifiedBytes - evictedBytes
  + currentStagingBytes
  + currentReservedRemainingBytes
  + requiredNewBytes
  <= hardLimitBytes
freeBytes + evictedBytes
  - currentReservedRemainingBytes
  - requiredNewBytes
  >= lowSpaceReserveBytes
```

cache metadata transactionはadmissionを直列化し、staging sweep、pin確認、同じchecksumの既存reservation共有、必要なLRU eviction、new byte reservation作成、Session pin reference追加を一つのtransactionでcommitする。reservation recordはchecksum、expected bytes、staging bytes、remaining bytes、consumer token集合、lease generationを持ち、共有時はconsumer tokenだけを追加する。downloadはcommit後にだけ開始する。書込みに応じて`currentStagingBytes`を増やしreservation remainingを同量減らし、検証成功時はstagingとreservationをverified entryへatomic rename / 移行する。一consumerのcancelはそのtokenとpin referenceだけを削除し、最後のconsumerがなくなった場合だけdownloadをcancelしてstaging / reservationをcleanupする。download自体のverification failureは全consumerのreadinessを失敗させてrecordをcleanupする。これにより複数Sessionが同じ空き容量や同じchecksumを重複予約せず、一方のcancelが共有downloadを破壊しない。

active / waiting SessionのDeliveryManifestがselectedしたverified checksumはpinする。eviction対象はunpinned、checksum検証済みのencoded fileだけで、persistent `lastAccessSequence: UInt64`昇順、同値はchecksumのUTF-16 code-unit昇順でLRU evictionする。cache metadata transactionを直列化し、checksum検証完了、または認可済みAsset response完了ごとにchecked incrementしたsequenceをatomicに永続化する。wall clock、filesystem mtime、directory走査順をLRU authorityにしない。

partial download、checksum mismatch、expired staging fileはLRUへ入れずcleanupする。staging metadataは`createdAtUnixMillis`と`leaseRenewedAtUnixMillis`を永続化し、leaseを15分、sweep intervalを5分、active downloadのrenew intervalを5分以下とする。稼働中のsweepはconsumer tokenがなく、または最後のlease更新から15分を超えたrecordだけを失敗としてcleanupする。process startup時は前processのin-flight requestが存在しないため、全stagingと全download reservation / consumer tokenを一transactionで削除してからdurable Session / Manifestのpinを再構築し、waiting Sessionは新しいadmissionを行う。これによりorphan reservationを`currentReservedRemainingBytes`へ残さない。wall-clock rollback時はactive processのmonotonic deadline、startup sweep、consumer cleanupを正本とし、期限判定が曖昧なstagingをverified entryへ昇格させない。

session終了 / cancel / waiting expiry後にreference countを減らし、0になったchecksumだけをevictできる。process restart時はdurable active / waiting SessionとDeliveryManifestからpin reference countを再構築してからadmission / evictionを許可する。再構築できない間はcacheをnot readyとしてevictionしない。GPU textureはactive session終了後にreference count 0のものをchecksum順にdestroyし、別sessionが共有するtextureを解放しない。

cache hard limit / reserveはEdge / client hostのdeployment configurationとしてbaselineより小さくできるが、Texture Capability Profileを変更しない。Runtime assignment / participant readinessはhost cache admissionの成功を別条件として検証する。cache missやevictionはRenderBundle identityを変えない。

### Diagnostics と failure atomicity

stable library diagnosticはlower-kebabとし、少なくとも次を固定する。

- `compiler-budget-pixel-target-exceeded`
- `compiler-budget-state-count-exceeded`
- `compiler-budget-render-surface-count-exceeded`
- `compiler-budget-texture-binding-count-exceeded`
- `compiler-budget-rendered-pixels-exceeded`
- `compiler-budget-capture-bytes-exceeded`
- `compiler-budget-output-bytes-exceeded`
- `compiler-budget-accounted-peak-exceeded`
- `renderer-timeout`
- `renderer-resource-exceeded`
- `delivery-texture-budget-exceeded`
- `delivery-artifact-unavailable`
- `asset-cache-admission-exceeded`
- `asset-descriptor-conflict`
- `asset-download-verification-failed`
- `asset-texture-residency-failed`

複数のpreflight違反はsemantic path、code、limit名のcanonical順で全件返す。renderer / encode / Delivery / cache / residency段階の失敗は、その境界のatomic unit全体を失敗させ、partial Bundle、Manifest、Readyを返さない。

## Consumer responsibility

| Consumer                     | Responsibility                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Contracts                    | Texture metadata、UInt32 / UInt64、budget tier、readiness shapeのportable source                |
| Presentation Core            | State coverage、count、metadata式、unique Asset / aggregate budgetのreject-only validation      |
| Compiler                     | resolution / count / pixel / capture / output / accounted peak、serial orchestrationのauthority |
| Presentation Assets          | PNG exact byte plan、per-transform hard cap、checksum / encoded size consistency                |
| Renderer API / isolated host | capture前budget、deadline / abort、process resource guard、partial result禁止                   |
| Control Plane / Delivery     | normalized tier、ordered candidate selection、GPU / CPU admission、Manifest atomicity           |
| Realtime / Edge cache        | encoded cache admission、pin、reference count、deterministic LRU、cleanup                       |
| Unity Asset Manager          | serial decode / upload、non-readable化、residency readiness、pin / destroy、telemetry           |

## Consequences

- 現行一texture / Stateの実装を維持しつつ、無制限なState / Surface / total outputをfail closedにできる。
- PNG transport bytes、build working set、runtime GPU、load CPU、disk cacheを別budgetとして検証できる。
- 全reachable StateをpreloadするためState transition / crossfade時にdownloadや追加GPU allocationを行わない。
- 2K RGBA32 textureは1枚16 MiBであり、baseline GPU tierではcontent-address dedup後に最大16枚相当となる。actual presentation shapeはcountとbyteの両方で制限される。
- 低解像度variant、mipmap、ASTC / KTX2、videoは実測と新contractなしに暗黙導入しない。

## Alternatives Considered

### Stateごとに1K / 2Kを常時生成する

現行resize / variant selectionがなく、build outputとresident候補を倍増させるため採用しない。複数resolutionはM4以降にprofile / candidate ordering / visual fixtureと同時導入する。

### Unityのruntime texture compressionへ依存する

platform supportとdriverで成否が分岐し、portable bytes / memory estimateを固定できないため採用しない。v1はRGBA32を明示する。

### current texture memoryを見てから暗黙downscaleする

participantごとに見た目とHit Region rasterが分岐し、Delivery admissionを後付けheuristicへ変えるため採用しない。

### 現在Stateと次Stateだけをon-demand preloadする

任意Cue / inputによる遷移前にdownload完了をcanonical progressionと同期するprotocolがないため採用しない。v1は全reachable Stateを開始前にresident化する。

## Follow-ups

- M3〜M4でTexture metadata、budget pure formula、Compiler preflight / aggregate、PNG alpha driftをTDDで実装する。
- M4で2K reference fixtureとbudget境界 / dedup / deterministic diagnostic goldenを追加する。
- M5でDelivery budget tier、download / resident readiness、Realtime cache pin / LRU、generated C# / Unity Asset Managerを接続する。
- Quest実機でprocess / driver overhead、upload peak、256 MiB tierを計測し、変更が必要なら新budget tier / policy versionとして更新する。
