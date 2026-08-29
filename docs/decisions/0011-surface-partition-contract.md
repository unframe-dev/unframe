# ADR-0011: Surface Partition と author isolate override を固定する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0006](0006-presentation-rendering-strategy.md), [ADR-0009](0009-semantic-tree-hit-region-contract.md), [ADR-0010](0010-spatial-surface-coordinate-contract.md), [Presentation Architecture](../presentation/ARCHITECTURE.md)

## Context

ArchitectureはSemantic Surfaceを一つ以上のRender Surfaceへlowerし、partition set / bounds / layerを全Stateで固定するとしている。しかし現行Compilerは各Semantic Surfaceをfull bounds / layer 0の一partitionへlowerするだけで、自動分割の入力、author override、paint order、ID導出、cross-partition Hit Region集約を定義していない。

Render Surfaceはbuild-localな描画partitionであり、Presentationの意味identityではない。過度な自動分割はartifact数とcompositing差を増やし、過度なauthor制御はderived ID / bounds / layerを意味contractへ逆流させる。本ADRはM2 item 5としてv1の保守的なpartition contractを固定する。M2では文書だけをAcceptedにし、Contracts / Authoring / Core / Compiler / Renderer / fixtureの実装はM3〜M4で同じ変更系列として行う。現行一partition実装が一般的な自動partitionを実装済みとはみなさない。

## Decision

### Authority と入力

Compilerだけがpartition topology、renderer selection、logical bounds、layer、RenderSurfaceIdを決定する。Rendererは一つの`RenderSurfacePlan`を受け取り、partition追加・merge・ID変更を行わない。Deliveryはbuild済みpartitionごとにcompatible artifactを選択するだけで、target capabilityに応じてrepartitionしない。

partition入力は次のcanonical valueだけとする。

- expanded Component Structureとstable SurfaceContentNode ID
- 全reachable Surface Stateへmaterializeしたcontent visibility / geometry
- manifest / renderer lockから解決したrenderer identity、contract version、execution class
- update model、interaction、internal animation、media lifecycle
- layout後のcanonical paint order、visual bounds、compositing closure
- manifestが許可し、instance authorが指定したPart isolate override
- partition strategy versionとCompiler / build configuration

object insertion order、filesystem走査順、renderer実行完了順、Browser DOM順、asset生成順、map iteration順を入力にしない。

### Render atom と required boundary

Compilerは各StateのSurface content treeをcanonical parent / sibling orderで走査し、paintを生成するleafをsemantic `RenderAtom`へlowerする。layout後に各atomのcanonical paint index、visual bounds、compositing closureを確定し、全reachable Stateの結果をpartition入力へ統合する。structural Frameはatomを所有せず、descendant rendererへ必要なlayout / clip contextとして複製できる。一つのrenderable content Nodeはちょうど一つのatomを所有し、一つのSemantic Surface内の一partitionだけへ所属する。

各atomはstable content Node ID、canonical paint index、resolved renderer identity、entry identity、execution class、compositing group、全Stateのpresenceを持つ。target `RenderSurfacePlan`はexactly-once ownershipを表す`ownedContentNodeIds`と、描画に必要だがownershipへ数えない`contextNodeIds`を別fieldとして持つ。Compiler aggregate validatorは全partitionのowned setを検査し、renderable Nodeの未所属と重複所属を拒否する。現行APIの単一`contentNodeIds`は一partition subsetだけの暫定形であり、M3でこの二fieldへ置換する。

次のいずれかが異なる隣接atom間にはrequired boundaryを置く。

- renderer identity / contract version / entry module
- `baked-web` / `native-ui` / `video`のexecution class
- update modelまたはmedia lifecycleを独立artifactとして保つ必要
- renderer capability上、一つのplanで処理できないrequired feature
- opaque renderer entry boundary

filter、mask、clip、blend、backdrop、group opacityなど複数atomを一つのoffscreen compositionとして評価しなければpixel-equivalentにならない範囲をcompositing closureとする。closureの正本はrenderer outputではなく、style tokenとComponent Manifestを解決済みのSemantic Authoring IRにある次のcanonical paint IRとする。

```ts
type SemanticPaintIRV1 = {
  atoms: readonly ResolvedRenderAtomV1[];
  closures: readonly CompositingClosureV1[];
};

type ResolvedRenderAtomV1 = {
  nodeId: SurfaceContentNodeId;
  paintIndex: UInt32;
  renderer: RenderSurfaceIdentityDescriptorV1["renderer"];
  executionClass: "baked-web" | "native-ui" | "video";
  partitionRendererKey: `sha256:${string}`;
  compositingGroupKey: `sha256:${string}`;
  presentByState: Readonly<Record<SurfaceStateId, boolean>>;
  visualBoundsByState: Readonly<Record<SurfaceStateId, LogicalBounds | null>>;
  effectPaddingByState: Readonly<
    Record<SurfaceStateId, { top: number; right: number; bottom: number; left: number }>
  >;
};

type CompositingClosureV1 = {
  ownerNodeId: SurfaceContentNodeId;
  operandNodeIds: readonly SurfaceContentNodeId[];
} & (
  | { operator: "source-over" }
  | { operator: "rect-clip"; clipBounds: LogicalBounds }
  | { operator: "group-opacity"; opacity: number }
);
```

Structured treeはcanonical child orderのdepth-first pre-orderで走査し、各Node自身のpaintをdescendantより先に一atomとしてemitする。paintしないstructural Nodeはemitしない。Opaque entryは一atomとしてemitする。`paintIndex`はarray indexと等しい一意な`0..N-1`で、DOM、object insertion、renderer outputから再導出しない。ordinary source-over paintにはclosure recordを作らず、全atomで共通のno-closure keyを使う。各明示closureのoperandはpaint順、non-empty、duplicateなしとする。Compilerはoperandのpaint indexの最小値から最大値までをintervalにし、overlapするclosureを推移的にunionする。owner、canonical operator tree、operand順をhashした値をそのunion内atomの`compositingGroupKey`とする。

`presentByState`、`visualBoundsByState`、`effectPaddingByState`は全reachable Stateをexactly onceで持つ。presentならboundsはfiniteかつ正、absentならboundsは`null`かつpaddingは全て0とする。paddingはfiniteかつnon-negativeである。closure ownerは同じSurfaceのexpanded content tree、全operandは同じIRのatomを参照し、外部Surface / 未知Node参照を拒否する。`closures`はowner Node IDとoperatorのUTF-16 code-unit順、operand paint index列、operator固有値の順にsortする。各merged closure groupは、この検証・sort後のclosure listをADR-0010の数値規則とRFC 8785 property orderでcanonical JSON化してSHA-256する。no-closure keyはcanonical JSON `{"kind":"no-closure","version":1}`のSHA-256として全buildで固定する。

v1のclosed operator kindは`source-over`、axis-alignedな`rect-clip`、`group-opacity`だけである。`clipBounds`はfiniteかつ正のlogical bounds、`opacity`はfiniteな`0..1`とする。mask、filter、blend、backdrop、非矩形clip、未宣言・未知operator、closure外のNodeを暗黙参照するparameter、non-contiguous operandは`compiler-partition-compositing-unsupported`で拒否する。Opaque entryは一atom / 一closureとして扱い、別entryとのcross-boundary effectを許可しない。closure内部に任意boundaryを置かず、required renderer boundaryとcompositing closureが衝突する場合は`compiler-partition-compositing-boundary-conflict`でbuild errorとする。

### v1 automatic partition

required boundaryとauthor isolate boundaryを反映したcanonical paint atom列を、同じCompiler internal `partitionRendererKey` / execution class / compositing groupが連続する最大runへ分割する。これをv1 automatic partitionとする。同じ要件のatomをbounds、Node数、texture size、heuristicだけを理由に分割しない。したがって現行standard Surfaceはoverrideがなければfull boundsの一partitionになる。

同じclassのatomが別partitionを挟む場合は再mergeしない。これにより各partitionはpaint order上の一つのcontiguous intervalとなり、overlap時も単純なback-to-front compositionで元のpaint orderを再現できる。Semantic Surfaceを越えるmerge、texture atlas、GPU batchingはpartition topologyの外側にあるAsset / Runtime最適化である。

### Author isolate override

v1のauthor overrideは公開Partを境界としてisolated paint intervalを要求する一種類だけとする。次は既存のcontent / placement / style overrideを省略したpartition関連のcontract抜粋である。

```ts
type PartDeclaration = {
  kind: "part";
  overridable: readonly ("content" | "placement" | "style" | "partition")[];
};

type StructurePartBinding = {
  partId: PartId;
  targetNodeId: SurfaceContentNodeId;
};

type PartPartitionOverrideDeclaration = {
  partId: PartId;
  partition?: { kind: "isolate" };
};
```

ManifestはPartの公開名とpermission、Structure Part bindingは一つのstable subtree rootとの対応を所有する。Component consumerは`overridable`に`partition`があるPartだけをisolateできる。project-local Structure authorも同じPart contractを通し、任意のprivate Node IDをinstance overrideから指定しない。Opaque Component内部のpartitionはpackage authorがManifest / renderer entryで宣言し、consumerは公開Part以外を参照しない。

`isolate`は対象subtreeのpaint intervalの前後にboundaryを要求するが、subtree内部のrequired renderer boundaryを消さない。isolate対象Part同士は同じSurfaceでstructural ancestor / descendant、canonical paint intervalの重複、duplicate指定を許可しない。これは2D geometry boundsのoverlapを禁止する規則ではない。intervalがinterleaveまたは重複する場合は`compiler-partition-isolate-interval-conflict`で拒否する。対象subtreeがpaint atomを持たない、paint orderでcontiguousでない、compositing closureを横断する場合もstable diagnosticでbuild errorとする。

v1は`merge`、author指定renderer、bounds、layer、RenderSurfaceId、artifact ID、state別partition、interaction / semantic parent変更を持たない。未知Part、binding欠落、permission欠落、禁止fieldをfail closedで拒否する。override解決順はManifest Part declaration、Structure Part binding、Component Instance override、expanded content tree、partition loweringとする。

### Bounds、state、layer

まずADR-0010の`surfaceVisibleWindow = SemanticSurface domain intersect inverseFit(physicalPlane)`をRenderSurfaceから独立に導出する。partitionのlogical boundsは、所有atomが全reachable Stateで生成し得るraw visual boundsとeffect paddingのaxis-aligned unionを求め、`surfaceVisibleWindow`とintersectionした最小rectangleとする。`RenderSurface.logicalBounds`自身をその導出入力にせず、bounds計算前にpixel roundingしない。全Stateでemptyのpartitionは生成せず、author isolateがemptyならbuild errorとする。

partition set、owned atom set、bounds、layer、Compiler internal `partitionRendererKey`は一つのbuild内の全reachable Stateで不変とする。各Stateはpartitionごとに一つ以上のartifact候補または明示的`empty` bindingをexactly onceで持つ。Stateごとのvisibilityはtopologyやboundsを変更しない。

partitionはcanonical paint interval順に`layer = 0..N-1`を重複なく割り当て、小さいlayerからback-to-frontに描画する。`renderSurfaceIds`もlayer昇順で保存し、同じlayerを許可しない。bounds overlapとtransparent gapは許可するが、renderable atomの未所属 / 重複所属、paint interval交差、layer gap / duplicateを拒否する。

### Derived identity と provenance

RenderSurfaceIdはauthoring入力に持たせず、次のdescriptorのcanonical JSONをSHA-256し、lowercase hex digestへ`rs_` prefixを付けて導出する。`logicalBounds`を含む数値はADR-0010のcanonical JSON規則に従い、non-finiteを拒否して`-0`を`0`へ正規化する。

```ts
type RenderSurfaceIdentityDescriptorV1 = {
  partitionStrategyVersion: 1;
  semanticSurfaceId: SemanticSurfaceId;
  renderer: {
    id: string;
    version: string;
    contractVersion: string;
    implementationHash: `sha256:${string}`;
    entry:
      { kind: "structured" } | { kind: "opaque"; entryId: string; moduleHash: `sha256:${string}` };
  };
  executionClass: "baked-web" | "native-ui" | "video";
  compositingGroupKey: `sha256:${string}`;
  ownedContentNodeIds: SurfaceContentNodeId[]; // paint order
  logicalBounds: LogicalBounds;
  layer: UInt32;
};
```

renderer identityは現行`RendererIdentity`の4 fieldをそのまま使い、entry、execution class、compositing groupもdescriptorへ別fieldで固定する。`compositingGroupKey`はcanonical compositing operator treeの`sha256:` hashであり、object identityや走査順を含めない。Compiler internal `partitionRendererKey`はdescriptorの`renderer`と`executionClass`だけを同じcanonical JSON / SHA-256規則でhashした`sha256:`値とし、implementation / entryの違いを必ず反映する。compositing semanticsは別の`compositingGroupKey`としてboundaryとdescriptorへ含める。ID formatは`rs_`と64桁lowercase hexからなり、M3でcanonical descriptor、partition renderer key、IDのgolden fixtureを追加する。

`ownedContentNodeIds`、`partitionRendererKey`、完全なdescriptorはCompiler internal build provenance sidecarにだけ保持し、portable RenderBundle / DeliveryManifestへ出さない。RenderBundleの各Render Surfaceは`partitionStrategyVersion`だけをportable partition provenanceとして保持する。Deliveryのartifact compatibilityは各artifact自身のkind、contract version、required featuresとtarget capabilityの一致だけを正本とし、partition provenanceを比較に使わない。structural context Nodeはrenderer planにだけ含め、ownershipへ重複計上しない。source、lockfile、Compiler / strategy version、configuration、layoutのいずれかがpartition descriptorを変えればIDは変わってよい。同じdescriptorから異なるID、または異なるdescriptorから同じIDが生成された場合はbuild errorとする。

### Renderer selection と failure

Compiler pass順は、semantic atom化、renderer requirement解決、lock済みcatalogからのcandidate選択、canonical compositing closure確定、required / isolate boundary適用、contiguous最大run化、bounds / layer / ID導出とする。required input kind / update model / interaction / animation / featureを満たすcandidateだけを残し、明示`rendererPreference`を満たせない場合はfallbackしない。`auto`はcandidateの`id`、`version`、`contractVersion`、`implementationHash`、canonical entry、execution classのtupleを順にUTF-16 code-unit比較し、最初を選ぶ。candidate catalog / lock / configurationをbuild hashへ含める。

`fallbackPolicy: "degrade"`はManifest / renderer contractが同じsemantics、partition topology、state coverageを保つnamed fallbackを宣言した場合だけ使用できる。partition topology変更、semantic削除、interaction削除、未知rendererへのfallbackは拒否する。一partitionのplanning / renderer / capture / validation失敗でSurfaceとRenderBundle全体をatomicに失敗させ、partial artifactやorphan Assetをpublishable outputにしない。

DeliveryManifest生成時にreachable Stateの非empty bindingを満たすcompatible artifactがなければ`delivery-artifact-unavailable`でManifest全体をatomicに拒否する。RenderBundleがそのStateへ明示した`empty`以外へ代替せず、別renderer、別partition、別Stateのartifactへfallbackしない。本ADRのdiagnostic codeは既存Compiler / Coreと同じlower-kebabのlibrary diagnostic stringであり、wire enumではない。

非empty state bindingの`artifactIds`はCompilerが選択優先順で並べたnon-empty / duplicate-free listとする。Deliveryはこの順序を変更せず、target capabilityとcompatibleな最初のartifactを選ぶ。後続候補の解像度 / format preferenceはM2 item 6のbudget contractで固定するが、複数compatible候補のtie-break authorityは常にこのordered listであり、record iterationやAsset ID辞書順を使わない。

### Cross-partition semantics と Hit Region

Semantic Tree、Interaction、Surface StateはSemantic Surface全体の正本であり、partitionへ複製して別identityを作らない。target Renderer APIはportable `HitRegion`ではなく、次のbuild-internal shapeをState ID keyed recordで返す。

```ts
type RendererPrivateHitRegion = {
  interactionId: InteractionId;
  semanticNodeId: SemanticNodeId;
  bounds: { x: number; y: number; width: number; height: number };
  priority: UInt32;
};

type RendererPrivateHitRegionsByState = Readonly<
  Record<SurfaceStateId, readonly RendererPrivateHitRegion[]>
>;
```

private `bounds`は`RenderSurface.logicalBounds`の左上を`(0, 0)`とするpartition-local logical coordinateであり、normalized `rx / ry`ではない。全値をfinite、`width / height > 0`、`0 <= x < bw`、`0 <= y < bh`、`x + width <= bw`、`y + height <= bh`とし、left / top inclusive、right / bottom exclusiveとする。`priority`はcanonical Interaction definitionの`hitPriority`をCompilerがcopyしてplanへ渡す値であり、rendererは生成・変更しない。`event`、State ID、RenderSurfaceId、layerをregion fieldへ重複させない。artifact producerがCompilerから受け取ったpartition clip windowとのintersectionを一度だけ適用し、clip後に面積0となるregionは出力しない。Compiler aggregate stageは再clipせずSemantic Surface全体のnormalized coordinateへ変換して全partitionのState別regionを結合する。Coreはaggregate後のportable `HitRegion`をreject-onlyで検証し、enabled Interactionのregion completenessをSurface全体で判定する。

Semantic Surface logical sizeを`W, H`、partition boundsを`bx, by, bw, bh`、private boundsを`x, y, width, height`としたaggregate式は`nx = (bx + x) / W`、`ny = (by + y) / H`、`nwidth = width / W`、`nheight = height / H`である。変換後もbinary64を保ち、pixel roundingや再clipを行わない。

現行Renderer APIの`RendererBuildSuccess.hitRegionsByState: HitRegion[]`は、一partition subsetがすでにSemantic Surface normalized regionを返す暫定contractである。M3では`RendererPrivateHitRegion`への置換、aggregate、portable `HitRegion`生成を同一sliceで移行し、local / normalizedの両方を同じfieldで許可しない。

同じbuttonが複数partitionまたはintervalにまたがる場合は、同じ`interactionId` / `semanticNodeId`を持つ複数regionとして表す。aggregate後にADR-0009のduplicate、enabled、button参照、priority / ID / bounds canonical orderをCoreがreject-onlyで検証する。RenderSurfaceId、layer、UV、pixel、partition-local coordinateをpublic Hit Regionへ含めず、visual layerをhit-test winnerに使用しない。

Native UI dynamic semantic textのprofile横断injective検証、enabled Interactionのregion completeness、crossfade中のinteraction無効化もSemantic Surface全体を単位に行う。

## Consumer responsibility

| Consumer               | Responsibility                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Authoring / Components | stable Part binding、partition permission、isolate overrideの宣言と静的検証               |
| Contracts              | policy / provenance / UInt32 layer / state bindingのportable runtime shape                |
| Presentation Core      | atom coverage、state-invariant topology、layer / bounds / region aggregate invariant      |
| Compiler               | paint atoms、boundary、renderer選択、ID / bounds / layer、atomic aggregateの唯一authority |
| Renderer API / Web     | 渡された一partitionだけを描画し、private geometry / regionとprovenanceを返す              |
| Delivery / Unity       | partitionごとのartifactを再選択せず固定し、layer順に合成する                              |

## Consequences

- defaultは一partitionのままで、現在用途のないheuristic分割を導入しない。
- renderer / compositing上必要な境界と明示許可されたPart isolateだけを決定的に反映できる。
- authorは意味IDやderived geometryを所有せず、Compilerの再生成可能性を保つ。
- cross-partitionでもState、Semantic Tree、Interaction、hit-test authorityは一つのSemantic Surfaceに残る。
- current Compiler / schema / Core / rendererはM3〜M4でtarget contractへ置換する。

## Alternatives Considered

### texture size / Node countによるheuristic split

budgetやBrowser差でtopologyとhashが変わり、次のM2 budget contractより先に閾値を埋め込むため採用しない。上限超過はbuild errorとし、明示isolateまたは別Semantic Surfaceで解決する。

### authorがRenderSurfaceId / bounds / layerを直接指定する

derived renderer topologyをsemantic sourceへ逆流させ、layout / Compiler変更を困難にするため採用しない。

### Deliveryがdevice capabilityごとにrepartitionする

participant間でvisual / Hit Region topologyが分岐し、PublishedPresentationのatomic hashを弱めるため採用しない。

### visual layerをhit-test priorityに使う

renderer detailをinteraction authorityへ混入させるため採用しない。Hit RegionはADR-0009の明示priorityだけを使う。

## Follow-ups

- M3 Slice AでPart binding / permission / isolate overrideをAuthoring / Components / CompilerへTDDで実装する。
- M3 Slice BでADR-0009のHit Region schema移行とpartition aggregate fixtureを同時に実装する。
- M4でmulti-partition reference project、Browser capture、deterministic ID / paint order fixtureを追加する。
- M2 item 6でheuristic splitを追加せず、artifact / GPU / RAM budgetと超過diagnosticを固定する。
