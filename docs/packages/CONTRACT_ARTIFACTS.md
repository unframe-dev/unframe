# Presentation v2 契約成果物

- **Status**: Normative target contract
- **Source**: `packages/contracts/src/presentation/v2/`
- **Scope**: Compiler 出力と publish 入力。現行 v1 consumer の移行は対象外。

## 成果物と leaf

| Schema                           | 意味                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `presentationDefinitionV2Schema` | Stage、Scene、Surface、Flow、Variable、Cue、Action、Timeline |
| `renderBundleV2Schema`           | Baked Web、Native UI、Video、Model の実行用成果物            |
| `assetSetManifestV2Schema`       | 配信する全 Asset descriptor の正本                           |
| `buildManifestV2Schema`          | build の source revision、成果物 hash、contract version      |
| `publishedPresentationV2Schema`  | 公開した build と `PublicationFence`                         |
| `capabilityProfileV2Schema`      | 正規化済み端末能力と resource limit                          |

全 object は strict とする。ID は ASCII の英数字で始まり、以降を英数字と `._:/-` に限定した
1〜128文字、media type は `image/png | image/jpeg | font/ttf | font/otf | video/mp4 |
model/gltf-binary`、Content Hash は `sha256:` と小文字16進64桁とする。
数値は有限値とする。個数、byte、
index、version、millisecond は `0..Number.MAX_SAFE_INTEGER` の整数、
duration、limit、epoch、contract version は正とする。`sourceAnimationIndex` と Hit Region
priority は UInt32 とする。未知 variant、required feature、追加 property を拒否する。

version は Definition 2、RenderBundle 2、AssetSet 2、Delivery 2、Runtime 2、Progression 1、
Projection 1 に固定し、該当 field は literal とする。

## Definition

`scene.nodes` は `container | model | surface | shape | light` の完全 union とする。Model は一つの
GLB Asset を参照し、SurfaceNode と SemanticSurface は一対一で対応する。Spatial TRS は local
値で、meter、正規化済み `[x,y,z,w]` Quaternion、正の scale を使う。Hamilton 積と canonical
sign は ADR-0010 に従う。SurfaceNode は leaf とする。parent は存在し、node parent graph は
非循環、同じ parent の `order` は一意とする。owner と
audience は Architecture の参照 closure を満たす。

3D Shape は box または sphere とし、sRGBA color を持つ固定 unlit shader で描画する。任意 shader、
texture、shadow cast/receive は持たず、両 shadow field は false とする。Directional Light の強度は
lux、Point/Spot Light は candela、range は meter、Spot angle は degree とする。Light は明示した
`castsShadows` だけを使用し、renderer 固有の強度係数や暗黙 shadow default を使わない。

Surface content は `frame | text | image | shape | video` の完全 union とする。record key と Node
ID は一致し、一つの root Frame から全 Node へ一度だけ到達可能とする。Node ID、kind、parent、
children、order、Frame layout kind、Video Asset は State 間で固定する。State override は対象 kind
の variant が列挙する field だけを変更する。Shape の寸法は変更できるが discriminator は固定する。

`semanticNodeId` は content と基底 Semantic Node の対応を明示する。省略できるのは装飾 content
だけとする。全 Semantic Node は content 一つから参照され、同じ Semantic Node を複数 content が
参照しない。対応可能な組合せは `frame -> list/table/row/button`、`text -> heading/paragraph/button/
listItem/cell/columnHeader/rowHeader`、`image -> image/button`、`shape -> button`、`video -> image/button`
とする。button の content 対応、button の `interactionId`、Interaction definition を一意に閉じ、
Compiler は対応 content の解決済み bounds から Hit Region を作る。文言、DOM、描画結果から対応を
推測しない。State で不可視になった content に対応する semantic node は同じ State の override で
除外し、その Interaction を enabled にしない。

Native UI へ lower する全 Text は `semanticNodeId` 必須とする。装飾 Text を含む partition は
Native UI artifact に変換せず build error とし、Compiler が意味 ID を生成または推測しない。

Layout は次に固定する。

- `absolute` の x/y/width/height は Surface logical unit とする。
- `stack` child は width/height 必須とする。宣言軸の寸法を基準に並べ、正の余りを `grow` 比で
  加える。負の余りは再配分せず overflow とする。
- `grid` の row/column は1始まり、span は track 内に収める。fixed track は logical unit、
  fraction track は正の余りを比率配分する。child は width/height 必須で、`stretch` の軸だけ
  cell 内寸へ置き換える。
- child placement kind は親 layout と一致させ、root は `absolute` とする。`clip: true` は Frame
  border box で子孫を clip する。Text overflow は Text bounds 内だけに適用する。

sRGBA channel と opacity は `0..1` とする。Node opacity は内容または Model material の出力 alpha
に乗算する。Text は regular/bold、明示 Font/fallback、単一行 alignment、clip/ellipsis に限定する。
動的 Text は型別 formatter、文字範囲、boolean label、number fraction digits、または Step timer
の完全な情報を Definition に持ち、同じ値を Native UI artifact へ lower する。Runtime が連続変更
できるのはこの `text.value` だけである。Text は正の `maxCodePoints` を必ず持ち、Compiler は
Native UI artifact の同 field へそのまま copy する。formatter 結果の truncate 上限を推測しない。

Semantic Tree は ADR-0009 の role union とする。role の親子制約、空でない accessible text/alt、
BCP 47 language、sibling order、button Interaction を検証する。override は role、level、order、
parent、Interaction を変えない。`included: false` は派生 Completed Tree から対象と子孫を除くが、
基底 Node は維持する。list、table、row を空にしない。

Variable の type と initialValue は一致させる。Cue は priority 降順、同値を order 昇順で選ぶ。
Trigger actor と producer を一致させる。`fixedPayload`、Guard、Action value は宣言済み scalar 型に
一致させる。`eq`/`neq` は同型、大小比較は有限 number だけを受ける。Cue の Action は同じ
pre-event state に対する atomic batch であり、property claim の重複を拒否する。

v2 の Trigger payload は次に固定する。

| Trigger                                                                 | 参照可能な source payload                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `logicalInput` / `surfaceInteraction` / `zoneEdge` / `motion`           | なし                                                                        |
| `timer` / `timelineCompleted` / `mediaCompleted` / `modelClipCompleted` | なし                                                                        |
| `semanticEvent`                                                         | なし。`event` は同じ Definition のいずれかの `Interaction.event` と一致必須 |

Component Output lowering は producer を上表の具体 Trigger へ変換し、Output の定数 payload を
Cue の `fixedPayload` に置く。`fixedPayload` は source payload との merge ではなく完全な置換で
あり、上表の source payload はすべて空なので collision 規則や precedence を持たない。
`eventPayload` reference は `fixedPayload` がある Cue だけで使用でき、存在する field の実値から
導出した scalar type と一致させる。`fixedPayload` がない Cue の `eventPayload` reference、存在しない
field、別 Cue の field は build error とする。`semanticEvent` は Interaction catalog にない任意名を
受け付けず、別の event registry や Runtime からの任意イベント注入を作らない。

Timeline は absolute 値を持つ。track は2個以上の keyframe を持ち、0から duration まで整数
millisecond で厳密に増加する。最終以外は `easingToNext` 必須、最終は指定禁止とする。opacity は
number、position/scale は Vector3、rotation は非ゼロ正規化 Quaternion とする。target/property
の重複と owner 違反を拒否する。

Model clip Action は `play | pause | resume | stop` とし、speed は有限かつ正とする。一つの Model
instance は通常一つの clip、crossfade 中だけ元先二つを評価する。crossfade 中の play は同じ要求も
拒否し queue しない。自然終了は最終姿勢、stop は現在姿勢を保持し、停止した二 clip mixture も
保持する。その mixture から新たな crossfade は開始できない。layer、body mask、additive animation、
root-motion placement の field は作らない。

`media.play/pause/seek` の target と Video renderer の Surface は、内容ツリーに Video Node を
ちょうど一つ持たなければならない。複数 Video、Video がない Surface、content ID を target とする
構成を拒否する。Video 再生位置は Runtime State が所有する。

## RenderBundle と AssetSet

各 RenderSurface は全 reachable State に binding をちょうど一つ持つ。空表示は `empty` を明示し、
それ以外は存在する互換 artifact を参照する。partition は ADR-0011 の bounds、clip、完全被覆、
非重複、canonical layer order を満たす。

Baked Web は PNG/sRGB と opaque/straight alpha の一方を使う。各 non-empty State は texture 一つ、
`mipCount: 1` とし、AssetSet と descriptor が一致する。texture build policy は Bundle hash に含める。

Native UI は group と単一行 text だけを持つ。一つの root から全 Node へ一度だけ到達し、cycle と
複数 parent を許さない。文字置換、boolean label、half-away-from-zero の number 丸め、timer、
glyph closure、font fallback、semantic text、truncate は Architecture §14.3 に従う。使用 feature
と `requiredFeatures` を完全一致させる。

Video は一つの Video Asset、duration、loop、codec、alpha、file 内 audio track の有無を持つ。
独立 Audio Asset、Action、State、capability は持たない。codec feature は一つだけとし、
`alpha`/`audio` は対応 track が実在する場合だけ要求する。v2 の基本 Delivery profile が admit
するのは H.264、alpha なしだけとし、同 profile は VP9、AV1、alpha を supported と申告しない。
これらの feature は Video artifact contract には維持するが、別の形式・budget profile が Accepted
になるまで Delivery で拒否する。基本 profile の MP4 映像 track は AVC High Profile、level 4.1
以下、8 bit、4:2:0、progressive に限定する。
interlace、10/12 bit、4:2:2、4:4:4を拒否する。音声 track は任意で一つだけとし、存在する場合は
AAC-LC（MPEG-4 Audio Object Type 2）、48 kHz、mono または stereo に限定する。Compiler は MP4
container と各 elementary stream を parse してこの値を検証し、file extension や codec 名だけで
判定しない。

Model は自己完結した `model/gltf-binary` とする。material は glTF 2.0 PBR metallic-roughness または
unlit、alpha は opaque/mask/blend に限定し、`alphaCutoff` は mask の場合だけ存在させる。
Model material は base color factor と texture の alpha を先に合成し、mask はその値へ cutoff を
適用する。残った fragment の alpha に ModelNode opacity を乗算する。元が blend、または Node
opacity が1未満の場合は描画時に source-alpha / one-minus-source-alpha blend と depth write off を
使う。opacity が1の opaque/mask は depth write on を維持する。これは配布 material の alpha mode
を書き換えず、Node ごとの effective pass を決める規則である。3D Shape の color alpha と Node
opacity にも同じ effective blend/depth 規則を適用する。skin、morph、animation、material、
alpha と required feature を一致させる。未知 required extension、外部 URI、script、Unity component、
Animator Controller を拒否する。

GLB は glTF 2.0 core と `KHR_materials_unlit` だけを許可する。`extensionsRequired` と
`extensionsUsed` の各要素はこの allowlist 内で重複なしとし、UTF-16 code unit 昇順にする。
Draco/Meshopt 圧縮、texture transform、clearcoat、transmission、lights、vendor extension は v2 で
受理しない。buffer と image は GLB 内に埋め込み、image media type は PNG または JPEG とする。

Model の node/primitive/vertex/triangle 数、skin ごとの最大 bone 数、primitive ごとの最大 morph
target 数、animation clip 数は、配布する GLB の default scene から到達する object を一度だけ数え、
参照される accessor の `count` を合計して Bundle に記録する。三角形数は triangle primitive の
index count（non-indexed は vertex count）を3で割った整数とし、三角形化できない mode を拒否する。
同じ mesh を複数 Node が instance 化する場合は各 instance の実行時負荷としてそれぞれ数える。
clip 数は `clips` record の要素数と一致させる。Capability admission はこの値を使用する。

Import 時は選択 glTF scene の `nodes` 配列が直接指す全 Node を scene root とし、全 clip から
それらを target とする translation/rotation channel を除去する。scale と子孫 target の channel は
内部姿勢として維持する。Compiler は scene を ModelNode 所有の不変 wrapper 配下に置き、残る
channel が wrapper を target にしないことを検証する。対応を一意に決められない source は拒否する。
Bundle は `rootMotion: "removed"` を記録し、consumer は clip 出力を ModelNode TRS に適用しない。

AssetSetManifest は配信 Asset の推移的 closure だけを持ち、self hash、URL、path、Session、
publication を持たない。Definition/Bundle から参照されない編集素材と、独立 audio、HTML、script
など allowlist 外の素材を拒否する。`assetSetHash` は manifest の RFC 8785 JCS bytes から外側で
計算する。

## 検証順序と diagnostic

consumer は次の順に検証し、違反時は publish/admission を停止する。複数 diagnostic は artifact 名、
JSON Pointer、code の順で並べる。

1. `canonical.invalid`: object 化する前の UTF-8 JSON bytes を読み、duplicate JSON key、lone
   surrogate、負のゼロ、JCS 化不能入力を拒否する。通常の `JSON.parse` で duplicate key を失って
   から検証してはならない。
2. `structure.invalid`: Zod schema で field、variant、scalar、version、hash を検証。
3. `identity.invalid`: record key/ID の一致と ordered ID list の重複なしを検証。
4. `reference.invalid`: 全 ID と Asset の参照 closure を検証。
5. `graph.invalid`: tree、topology、order、layout、owner、audience、semantic、partition を検証。
6. `behavior.invalid`: Variable、Trigger、Guard、Action、State、Timeline、Media、Model playback を検証。
   Guard は深さ16、総 predicate 256以下とする。
7. `artifact.invalid`: State binding、feature、format、budget policy、Model import、Native UI closure、
   descriptor 一致を検証。feature array は重複なし、UTF-16 code unit 昇順とする。
8. `hash.invalid`: Definition、Bundle、AssetSet の JCS hash と BuildManifest、revision、version を検証。
9. `capability.unsupported`: 固定 version と全 feature、個別値と合計値が対応 limit tier 以下か検証。
10. `publication.invalid`: PublishedPresentation と BuildManifest を比較し、
    `publicationManifestHash` 以外の全 field を含む JCS bytes から同 hash を再計算する。epoch が正かつ
    単調増加することを確認して atomic replace する。

Capability limit は正規化済み admission 設定であり端末測定完了を意味しない。`supported: false` の
方式も完全な limit を持つが、その方式の選択は拒否する。

limit の集計単位は次に固定する。

- Texture の width/height/pixels は一枚、bindings/GPU bytes は選択した全 reachable texture の
  合計、serial-load CPU bytes は一枚を decode/upload する最大値、encoded cache bytes と reserve
  は端末 cache 全体に適用する。
- Native UI の nodes/tree depth/text nodes は一 artifact、code points は一 Text、glyphs と Font
  Assets は同時選択された全 artifact の重複を除いた closure に適用する。
- Video の width/height/pixels/decoded frame bytes は一 Video、encoded bytes は選択 Asset の合計、
  concurrent decoders は同時に playing または paused で保持する decoder 数に適用する。
- Model の assets は選択した一意な Asset 数、instances は ModelNode 数、encoded bytes は一意な
  Asset の合計とする。nodes/primitives/vertices/triangles は instance 展開後の合計、bones は一 skin、
  morph targets は一 primitive、animation clips は一 Asset に適用する。
