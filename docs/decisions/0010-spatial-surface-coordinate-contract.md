# ADR-0010: Spatial / Surface / Unity 座標変換を固定する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [ADR-0005](0005-spatial-presentation-domain-model.md), [ADR-0006](0006-presentation-rendering-strategy.md), [Presentation Architecture](../presentation/ARCHITECTURE.md), [Unity coordinate system](https://docs.unity3d.com/Manual/QuaternionAndEulerRotationsInUnity.html), [Unity Matrix4x4](https://docs.unity3d.com/ScriptReference/Matrix4x4.html), [Unity Mesh UV](https://docs.unity3d.com/ScriptReference/Mesh-uv.html)

## Context

ADR-0005はmeter、right-handed、Y-up、forward -Z、`[x, y, z, w]` Quaternionまでを固定したが、親子Transformの合成順、Quaternion符号、matrix layout、Unityのleft-handed座標への変換は未定義だった。Semantic Surfaceは左上原点のlogical coordinateと`contain / cover / stretch`を持つ一方、physical plane、normalized Hit Region、Render Surface、raster pixel、Unity UVの相互変換も未定義だった。

このままでは同じPresentationDefinitionから生成したWeb preview、RenderBundle、Unity sceneで位置、回転、crop、hit-testが一致しない。本ADRはM2 item 4としてportable coordinate contractを固定する。M2では文書だけをAcceptedにし、Contract / Coreのfixture、Compiler変換、renderer geometry、Unity importerは対応するM3〜M5 sliceで実装する。現行schemaとUnity sample importerが本ADRを満たすとはみなさない。

## Decision

### Canonical Spatial coordinate

Canonical Spatial coordinateは次を満たす。

- right-handed、+X right、+Y up、forward -Z
- positionとphysical sizeはmeter、scaleはdimensionless
- vectorはcolumn vectorとして左からmatrixを作用させる
- QuaternionはHamilton product、成分順`[x, y, z, w]`、active rotationとし、vectorは`q * [v, 0] * inverse(q)`で回転する
- Euler angleはportable contract、artifact、fixtureに使用しない

Quaternionは有限かつ非ゼロでなければならない。Compilerの明示的なcanonicalizerはauthoring inputをunit lengthへ正規化し、同じrotationを表す`q`と`-q`から一つを選ぶ。`w > 0`を優先し、`w === 0`では`x`、`y`、`z`の順で最初のnon-zero成分が正になるよう必要なら全成分を反転する。canonical outputでは`-0`を`0`にする。Contractsのruntime schemaはtuple shapeとfinite numberだけを検証し、Presentation Coreと各wire mapperが`abs(norm - 1) <= 1e-9`とcanonical signをsemantic validationする。Compilerより外側のconsumerは不一致を拒否し、黙ってnormalize / sign flipしない。Timeline interpolationはADR-0007のshortest-path規則で補間した後、Runtime Coreの明示的なcanonicalizerで同じ処理を行ってからportable projectionを生成する。現行Control Plane / Webの`1e-4`とCoreのnorm-only検証はtarget contractとのdriftであり、consumer接続sliceで`1e-9`とsign検証へ統一する。

### TRS、親子合成、matrix layout

local Transform `L = { position: p, rotation: q, scale: s }`のderived matrixを次に固定する。

```text
M_local = T(p) * R(q) * S(s)
M_world = M_parent_world * M_local
v_world = M_world * [v_local.x, v_local.y, v_local.z, 1]^T
node_origin_world = M_world * [0, 0, 0, 1]^T
q_world = q_parent * q_local
```

したがってlocal pointにはscale、rotation、translationの順で作用し、child local Transformを先に、parent Transformを後に作用させる。`q_world`はlocal orientationだけを合成する補助値であり、non-uniform scaleとrotationによるshearを含むworld matrixから抽出したrotationではない。scaleは各軸とも有限かつ正で、authoringによるreflectionとzero scaleを許可しない。non-uniform scaleを持つancestorとrotationの組合せはworld matrix上でshearを生み得るため、world Transformをposition / rotation / scaleへ再分解して正本にしない。Spatial treeの正本はlocal TRS、derived world値の正本は常にfull matrixとする。

v1のPresentationDefinition、RenderBundle、Realtime wireはderived world matrixをfieldとして保存せず、local TRSだけを保持する。matrixはCompiler / Runtime / Unity adapterのderived internal valueとcross-language fixtureに限定する。fixtureのportable matrixはbinary64の16要素column-major flat arrayとし、`index = row + column * 4`、translationは最後のcolumnに置く。matrix積の意味は上記のcolumn-vector式に従う。行優先APIのconsumerは境界で転置またはindex変換し、fixture順を変更しない。将来matrixをwire fieldへ追加する場合は新しいversioned contractを必要とする。

### Unity conversion

Unityはleft-handed、+X right、+Y up、+Z forwardであるため、canonicalとUnityの境界はZ軸reflection `C = diag(1, 1, -1, 1)`を一度だけ適用する。

```text
positionUnity   = [ x,  y, -z ]
rotationUnity   = [-x, -y,  z,  w]
scaleUnity      = [ sx, sy, sz ]
matrixUnity     = C * matrixCanonical * C
```

この変換は自己逆であり、UnityからCanonicalへ取り込むAnchor pose / Tracking poseにも同じ式を使う。Unity importerは変換済みlocal position、local rotation、local scaleを変換済みparentの`Transform`へ設定し、world TRSの再分解、Euler変換、追加のZ反転を行わない。`Quaternion(x, y, z, w)`の成分順はportable contractと同じだが、handedness変換なしに値を直接代入してはならない。

Canonical matrixのcolumn-major wire順はUnity `Matrix4x4`のindex規則と同じである。ただしhandednessが異なるため、raw 16値を直接コピーせず必ず`C * M * C`を適用する。doubleからUnity `float`へ変換するとき、有限なfloat範囲外または変換後にnon-finiteとなる値はcapability / import errorとし、clampしない。

### Semantic Surface logical / physical plane

Semantic Surfaceのlogical sizeを`W, H`、physical sizeを`Pw, Ph`とする。すべて有限かつ正とする。logical coordinateは左上原点、+X right、+Y downで、content domainは`0 <= x < W`、`0 <= y < H`である。normalized logical coordinateは次とする。

```text
nx = x / W
ny = y / H
```

Surface local planeは中心原点、+X right、+Y up、Z=0、front normal +Zとする。Canonical forward -Z方向に置いたSurfaceを原点側から見たときfrontが見える。Unity変換後のfront normalは-Zとなり、UnityのXY quad規則と一致する。

fitごとのlogical-to-meter scaleを次に固定する。

```text
stretch: sx = Pw / W, sy = Ph / H
contain: s = min(Pw / W, Ph / H), sx = sy = s
cover:   s = max(Pw / W, Ph / H), sx = sy = s

localX = (x - W / 2) * sx
localY = (H / 2 - y) * sy
localZ = 0
```

`contain`の余白は透明でsemantic contentもHit Regionも持たない。`cover`はphysical plane外をclipする。`stretch`だけがaspect ratioを変える。fit offsetは常に中央寄せとし、v1にauthor指定のalignment / focal pointを持たせない。

raycastで得たSurface local pointは逆変換する。

```text
x = localX / sx + W / 2
y = H / 2 - localY / sy
```

physical plane、logical content domain、現在Stateのvisible geometryの順に判定し、domain外、letterbox、clip済み領域はhitしない。normalized pointへ変換した後のHit Region判定はADR-0009のhalf-open / priority規則だけを使い、境界epsilonやpixel roundingをauthorityにしない。

rayはfront faceだけをhit対象とする。Canonical Surface local spaceの有限なray originを`o`、有限で非ゼロのdirectionを`d`、front normalを`n = (0, 0, 1)`とする。`denominator = dot(n, d) = d.z`が`< 0`の場合だけ`intersectionT = -o.z / d.z`を計算し、finiteかつ`intersectionT >= 0`の場合だけ半直線上の候補`o + intersectionT * d`として評価する。back-face、parallel ray、負のintersection、non-finite inputはno-hitとする。Unityでは変換後normal`(0, 0, -1)`に等価な規則を適用する。intersectionのlocal pointは`-Pw / 2 <= localX < Pw / 2`かつ`-Ph / 2 < localY <= Ph / 2`を満たす場合だけplane内とし、logical top / leftをinclusive、bottom / rightをexclusiveに保つ。

### Render Surface、raster、UV

Render Surfaceのlogical boundsを`B = { x: bx, y: by, width: bw, height: bh }`とする。boundsはSemantic Surface logical coordinateにあり、有限、正、Surface domain内でなければならない。Render Surface内のnormalized coordinateは次とする。

```text
rx = (x - bx) / bw
ry = (y - by) / bh
```

rendererのlayout / raster pixel coordinateは左上原点で、`pixelX = rx * pixelWidth`、`pixelY = ry * pixelHeight`とする。pixel domainはhalf-openである。raster artifactはRender Surface bounds全体をedge-to-edgeで表し、artifact内で別のcontain / coverを適用しない。

Semantic Surface全体のnormalized point`(nx, ny)`からpartition-local coordinateへ変換する場合は、いったん`x = nx * W`、`y = ny * H`へ戻して上式を適用する。逆変換は`nx = (bx + rx * bw) / W`、`ny = (by + ry * bh) / H`とする。Hit Region wireへ保存するのはこの逆変換後のSemantic Surface全体基準だけである。

Unity mesh UV0は左下原点なので、logical / rasterから次の一回のY flipで変換する。

```text
u = rx
v = 1 - ry
```

したがってlogical top-leftはUV `(0, 1)`、bottom-right boundaryは`(1, 0)`である。region rectangleのUV bottom-leftは`(rx, 1 - (ry + rh))`となる。texture importer、mesh、shaderの複数箇所で重ねてflipせず、Unity mesh / material adapterがこの変換を所有する。graphics API固有のrender-target orientationはportable contractへ露出させず、Unity renderer boundaryで吸収する。

### Crop、partition、Hit Region

physical planeがlogical spaceで覆うviewportは逆fit式から導出する。geometryとHit Regionは次のintersectionをlogical coordinateで求めてからSemantic Surface全体の`W, H`でnormalized化する。

```text
inverseFit(physicalPlane) =
  [W / 2 - Pw / (2 * sx), W / 2 + Pw / (2 * sx))
  x [H / 2 - Ph / (2 * sy), H / 2 + Ph / (2 * sy))
```

```text
surfaceVisibleWindow =
  SemanticSurface([0, W) x [0, H))
  intersect inverseFit(physicalPlane)

partitionVisible = geometry
  intersect RenderSurface.logicalBounds
```

`contain`のinverse physical viewportはlogical domainより広いためcontent側でclipされ、余りはletterboxになる。`cover`ではinverse physical viewportがlogical domainの部分集合となり、cropされたgeometryとregionを出力しない。複数Render Surfaceへpartitionしてもnormalized Hit RegionはSemantic Surface全体を分母にし、partition-local `rx / ry`やUVをDeliveryへ出さない。partition境界にまたがる一つのbuttonは複数regionへ分割でき、ADR-0009のduplicate / canonical order規則に従う。

clipのauthorityは一方向にする。CompilerはまずRender Surfaceに依存しない`surfaceVisibleWindow`を決定し、raw visual unionとのintersectionから各`RenderSurface.logicalBounds`を導出する。次にそのboundsをpartition clip windowとしてrenderer planへ渡すが、rendererが返すconcrete geometryを先にclipしない。artifact producer（Browser renderer、またはNative UI planを生成するCompiler stage）がこのwindowとのintersectionを一度だけ適用し、partition-local private geometry / regionを出力する。Compiler aggregate stageはregionを再clipせずSemantic Surface normalized coordinateへ変換し、Presentation Coreは出力がwindow内であることを再検証して、補正せず違反をbuild errorにする。

### Numeric and validation policy

すべてのcoordinate、matrix、Quaternion計算はCompiler / rendererではIEEE 754 binary64で行い、入力・各portable出力でnon-finiteを拒否する。canonical JSONはJSON numberを使用し、`-0`を`0`へ正規化する。hit-testはDeliveryされたboundsをそのまま使い、consumerごとにboundsを再rasterizeしない。

Unityのauthoritative hit-testはPhysics / Colliderが返したfloat hit pointを直接authorityにしない。sampled Quest-local ray origin / directionをcurrent `ParticipantCalibration.presentationFromQuestLocal`でCanonical Presentation Spaceへ変換してbinary64へ昇格する。Surfaceのworld matrixは、一つにfreezeしたState Frame / Control cutとlogical timeに属する`ParticipantRuntimeView.nodeStates`、active Timeline Runのeffective local Transform、Projected Runtime SnapshotのPresentation Origin、Spatial parent chain、State Streamのfresh Anchor sampleからbinary64で再構築する。このinverse world matrix、plane intersection、inverse fit、normalized boundsの順に評価する。

State Frameは`frameSequence`、logicalな`producedAtRuntimeTime`、transport用`producedAtRuntimeMonotonic`、`baseReliableSequence`、`presentationOriginVersion`とAnchor binding patchをatomicに運ぶ。patchはraw pose catalogではなくvisibleなAnchor-bound Node IDをkeyにし、そのNodeの`followPosition` / `followRotation`が要求する成分だけを持つ。追従しないpositionはzero translation、追従しないrotationはidentityとしてparent matrixを構成する。sampleは元`trackingFrameSequence`、Runtime受理時の同じmonotonic domainの`observedAt`、Presentation Space parent poseを持ち、ADR-0008の`anchorSampleMaxAgeMilliseconds = 500`を超えるとRuntime / client双方でunavailableにする。Connection Resume後はProjected Runtime SnapshotからOrigin pose / versionを得た後、State Streamの初回keyframeまたは後続fresh sampleがbindingを確定するまで該当Nodeを描画もhit-testもしない。`presentationOriginVersion` / assignment epoch / cutが不一致、calibrationまたはbindingがunavailable / stale、nodeがinactive / invisibleの場合はno-hitとし、新しいprojection / stateを要求する。Unity Colliderはcandidate Surfaceのbroad phaseにだけ使用できる。比較はADR-0009と本ADRのhalf-open式をexactに適用し、epsilonを足さない。これにより同じquantized input ray、runtime sample、Delivery artifactに対する分類を固定する。

Cross-language fixtureは少なくともidentity、nested translation / rotation / non-uniform scale、Quaternion `q / -q`、Z reflection、contain letterbox、cover crop、stretch、Render Surface offset、UV Y flip、edge-exclusive hitを含む。各domain / region境界についてexact boundary、隣接する直前値、直後値を含める。TypeScriptのderived matrix / coordinateはexpected binary64に対してabsolute error `1e-9`以下、Unityのvisual Transform float結果は同じfixtureのexpected値に対してabsolute error `1e-5`以下で比較する。domain / hitの内外判定とUnity authoritative hit-testはbinary64のexact comparisonを使い、この許容差を使用しない。

## Consumer responsibility

| Consumer                 | Responsibility                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Contracts                | finite local TRS、positive scale / size、Quaternion tuple、logical boundsのportable runtime shape        |
| Presentation Core        | parent graph、Quaternion norm / sign、TRS / matrix invariant、bounds / fit / regionのsemantic validation |
| Compiler                 | Quaternion / local TRS canonicalization、world matrix、fit / partition / canonical clip windowの決定     |
| Renderer API / Web       | top-left logical / pixel geometry、clip windowの一回適用、partition-local private region                 |
| Control Plane / Delivery | coordinate contract / capability versionの一致とportable artifactのfail-closed validation                |
| Unity                    | Z reflection、Surface / UV、binary64 authoritative ray inverse / hit-testとvisual float rangeを検証      |

## Consequences

- Canonical worldとUnity worldのhandedness差を一つのself-inverse変換へ隔離できる。
- local TRSとderived matrixのauthorityが明確になり、non-uniform scale下のlossyな再分解を避けられる。
- Web layout、texture、Unity quad、normalized Hit Regionが同じlogical coordinateから導出される。
- current schema / renderer / Unity importerへの実装変更とfixture追加は後続Milestoneで行う。

## Alternatives Considered

### Canonical coordinateをUnity left-handedへ合わせる

既にAcceptedのADR-0005と外部contractを破り、Web /標準的なright-handed toolchainとの境界を曖昧にするため採用しない。

### Unity importerごとにaxis変換を選ぶ

Asset種別、Anchor、Timeline、Surfaceで変換が分岐し、double flipを検出できないため採用しない。

### Surface originを左上の3D local pointにする

Spatial Transformのpivotとvisual centerがずれ、rotation / scaleの直感とUnity quadの利用を損なうため採用しない。2D logical originだけを左上に保つ。

### UV / pixel座標をHit Region wireへ送る

resolution、partition、graphics APIへinteraction authorityが依存するため採用しない。Hit RegionはSemantic Surface normalized logical coordinateだけを使用する。

## Follow-ups

- M3でContracts / Core / Compiler / rendererにcoordinate fixtureとstable diagnosticを追加する。
- M4のreference projectでcontain / cover / stretchとpartition境界のbrowser render / hit fixtureを追加する。
- M5でDelivery contract versionとUnity EditMode fixtureを接続する。
- [x] M2 item 5で本ADRのvisible intersectionを前提にSurface Partitionとauthor overrideを [ADR-0011](0011-surface-partition-contract.md) へ固定した。
