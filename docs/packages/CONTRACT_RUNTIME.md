# Presentation Delivery / Runtime v2 contract

- **Status**: Normative target contract
- **Wire source**: `packages/contracts/proto/unframe/{presentation,delivery,realtime}/v2/`
- **Related**: [Architecture](./ARCHITECTURE.md), [Data model](./DATA_MODEL.md), [ADR-0007](../decisions/0007-timeline-runtime-run-wire-contract.md), [ADR-0008](../decisions/0008-runtime-transport-contract.md), [ADR-0009](../decisions/0009-semantic-tree-hit-region-contract.md), [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md), [ADR-0011](../decisions/0011-surface-partition-contract.md), [ADR-0012](../decisions/0012-texture-budget-residency-contract.md), [ADR-0015](../decisions/0015-presentation-definition-artifact-boundaries.md), [ADR-0016](../decisions/0016-model-animation-scope.md)

この文書は Delivery と Runtime の v2 wire を実装する際の required presence、検証、状態遷移、失敗結果を固定する。`realtime.v1` は未完成の foundation であり、v2 への互換 adapter、fallback、downgrade は作らない。

## 1. Version と数値

有効な組み合わせは次の一つだけである。

| 項目                                   |           値 |
| -------------------------------------- | -----------: |
| Delivery schema / contract             |    `2` / `2` |
| Capability schema                      |          `2` |
| Runtime protocol / contract            | `"v2"` / `2` |
| Progression contract                   |          `1` |
| Projection contract                    |          `1` |
| Projected runtime catalog contract     |          `2` |
| Connection / canonical snapshot schema |          `2` |
| Durable checkpoint schema              |          `2` |

同じ major 内で未知の通常fieldはwire decoderが保持または無視してよい。ただしrequired `oneof`は、同じmessageに未知fieldが共存していても既知variantが一つもdecodeされなければ空oneofとしてrejectする。これにより未知variantを既知messageとして誤適用しない。未知の enum 値、未知の required capability、上表と異なるversionも解釈せずfail closedにする。required fieldやvariantを増やす変更は新majorを必要とする。

Protoの`uint32`は`0..4_294_967_295`、`uint64`は`0..18_446_744_073_709_551_615`である。JSONへ変換するconsumerはすべての整数を`0..9_007_199_254_740_991`に制限し、超過をrejectする。JSON numberをwireへ変換する際はfinite、integer、non-negative、安全整数を順に検証する。`double`はfiniteでなければならず、`NaN`、正負Infinity、`-0`をrejectする。ただし次段落のMedia/Model clip sample positionだけは入力境界で`-0`を`0`へcanonicalizeして受理する。

logical runtime time、duration、deadline、retention、expiryは非負の整数millisecondであり、duration、retention、expiryは明記がない限り正とする。Compilerが秒単位の素材durationを変換する場合、binary64で`seconds * 1000`を計算しhalf-away-from-zeroで整数化し、正のdurationが`0`へ丸められた場合は`1`へclampする。Media/Model clipのsample positionだけは速度適用後の正確な位置を保つfiniteな`double` millisecondとし、`-0`を`0`へcanonicalizeする。sample positionを整数へ丸めない。

`ScalarValue`はstring、finite number、boolean、明示nullのexactly one variantを持つ。空oneofはnullではない。`ScalarType`と値variantは一致しなければならない。

## 2. 共通presence、ID、順序

次をすべてのmessageへ適用する。

- non-`optional` Proto3 scalarはwire上の省略とdefault値を区別しないため、省略されたdefault値もそのfieldの値として受理する。意味上presenceを区別する必要があるscalarはschemaで`optional`にし、presenceを検証する。正値などのrange制約があるfieldはdefault値`0`をrange違反としてrejectする。
- message、`oneof`、ID、hash、URL、media type、tier IDはrequiredである。scalarのpresenceは`optional`と宣言したfieldだけ検証し、省略可能性と値域は各fieldの規則に従う。
- IDはASCII正規表現`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`に一致する1..128 bytesとする。正規化や大小文字変換をせずbyte-exactに比較する。人向けの表示文字列、Semantic text、labelにはこのID制約を適用しない。
- content hashとchecksumは`sha256:`に64桁lowercase hexadecimalを続けたexactly 71 bytesとする。
- `publication_epoch`、`assignment_epoch`、`run_sequence`、event `sequence`、`group_entry_epoch`、`step_entry_epoch`、`checkpoint_sequence`は正の値とする。origin version、replay cursor、snapshot reliable sequence、ingress sequenceは`0`を有効な初期値とする。
- keyed repeated entryはkeyがnon-emptyかつduplicate-freeで、UTF-16 code-unit昇順にserializeする。明示された表示順、layer順、keyframe順、fallback font順は意味を持つため並べ替えない。
- feature/capability配列は`UNSPECIFIED`を含まず、numeric enum値昇順、duplicate-freeとする。
- Quaternionはfinite、unit lengthとの差が`1e-9`以下、canonical signでなければならない。Transformのscale各成分はfiniteかつ正、opacityとblend weightは`0..1`である。

required messageの欠落、空oneof、unknown enum、重複key、非canonical順、参照不整合をconsumerが補完・並べ替え・正規化して継続してはならない。

## 3. Publication と Delivery

`PublicationFence`はPresentationごとに一つのimmutableな公開物を指す。Delivery、Control、State、Snapshot、Eventのfenceはbyte-exactに一致しなければならない。manifest hashはDefinition、RenderBundle、AssetSet、contract versionsを束ねる公開manifestのcanonical JSONから算出する。

`DeliveryManifest`はDefinition全体を配布しない。次だけを含む。

1. Publicationとartifact hash。
2. Control Planeが認証済みclient buildとdevice classから正規化した`CapabilityProfile`。
3. roleとcapabilityから生成した共有可能な`ProjectionProfileDescriptor`。
4. participantとassignmentに固有な`ProjectionInstance`。
5. selected assetだけの期限付きaccess binding。
6. selected graphに対応するresidency plan。

`CapabilityProfile`のversionsは`delivery=2 / runtime=2 / progression=1 / projection=1`で固定する。`supported=false`のrenderer/modelはcontract version `1`と空feature集合を持ち、対応するartifactを選択できない。`supported=true`ではcontract version `1`、そのkindが必要とするfeature、正のlimitを必須とする。Model formatは`GLTF_BINARY`だけを許す。WebView、embedded HTML/JS/Wasm、独立音声のcapabilityや予約値を追加しない。

すべてのlimitとtier IDはrequiredである。`TextureLimits`、`NativeUiLimits`、`VideoLimits`、`ModelLimits`の数値は正でなければならない。`encoded_cache_reserve_bytes < max_encoded_cache_bytes`を要求する。`max_blended_clips_per_model`はcapabilityによらず`2`、通常時は`1`であり、layer、mask、additive blendを表すfieldは存在しない。

Limitの集計単位は次に固定する。Texture width/height/pixelsは一texture、bindingsとGPU bytesはprofile全体のunique selected texture、serial CPUは一textureのmax、encoded cacheは全selected Assetで判定する。Native UI node/depth/text/code pointは一artifact、glyphとfont Assetはprofile全体のunique集合で判定する。Video width/height/pixelsは一video、encoded bytesはunique selected videoのsum、decoded frame bytesは同時decoder instance集合のsumである。Model Asset、instance、encoded bytes、nodes、primitives、vertices、trianglesはprofile全体のunique Asset集計、bonesは一skin、morph targetは一primitive、animation clipは一Assetの上限である。

### 3.1 Projection profile

Profile keyはPublication、projection contract、role、capability profile IDからなる。同じkeyは同じcanonical descriptorとprofile IDを生成する。profile IDにはparticipant、assignment、endpoint、credential、URL、expiryを含めない。

`projection_profile_id`はdescriptor自身のID fieldを除いた次のidentity JSON mappingをRFC 8785でcanonicalizeし、そのUTF-8 bytesをSHA-256したlowercase digestへ`pp_`を付けた67-byte stringとする。

- messageはJSON object、keyはdescriptorに記載されたProto fieldの`snake_case`名とする。`projection_profile_id`だけを再帰の開始前に除外する。unknown fieldを含むdescriptorはidentity生成対象としてrejectする。
- non-`optional` scalarはdefault値を含め常に出力する。presentな`optional` scalarだけを出力し、absentならkeyごと除外する。required messageは常に出力する。
- `oneof`は選択されたfieldのkeyと値だけを出力する。空oneofは生成前にrejectする。空marker messageの値は`{}`とする。
- stringとboolは同じJSON primitive、`uint32`はJSON number、`uint64`はleading zeroのない10進JSON string、enumはその非負numeric valueをJSON number、finite `double`は`-0`を除くJSON numberとする。bytes fieldはProjectionProfileDescriptor closureに存在してはならない。
- repeated fieldは空でも必ずJSON arrayとして出力する。`visible_node_ids`、`visible_surface_ids`、`visible_variable_ids`など集合を表すrepeated stringはUTF-16 code-unit昇順、featureはnumeric昇順、keyed entryは前節のkey順とする。children、fallback font、layer、keyframeなどsemantic orderを持つfieldはwire順を維持する。生成前にduplicateと非canonical順をrejectする。

このmappingはprofile identity専用で、標準protobuf JSON mappingやprotobufのdeterministic serializationを正本にしない。

Profileは次のclosureをexactに満たす。

- `visible_node_ids`はroleに可視なNodeと、その可視Nodeに必要な可視Spatial ancestorの集合。
- `visible_surface_ids`は可視host NodeのSemantic Surface集合。
- `render_surfaces`は各visible Surfaceの全partitionをlayer `0..N-1`でexactly once含む。
- `semantic_surfaces`はvisible Surfaceをexactly once含み、全reachable Stateの完成済みprojected semantic treeと有効Hit Regionを含む。
- `visible_variable_ids`はselected Native UI artifactのbinding closureと一致する。
- `runtime_catalog`は投影されたNode、Surface、Variable、Timeline、Model clipのうちclientの表示、補間、復元に必要な項目だけを含む。
- catalogのTimelineはすべてのtarget Nodeがvisibleな場合だけ含める。partial track、target削除、Timeline分割は禁止する。
- node、surface、variable、Timeline、model clip entryはpresentationまたは一つのGroup ownerを明示する。model clip entryはvisible ModelNodeが参照できる全clipを、`model_node_id / clip_id`の組でexactly once含む。

Viewerのbuttonは`interaction_enabled=false`かつ`interaction_id` absentである。Presenterでもdisabled buttonは同じ形とする。enabled buttonだけがinteraction IDを持ち、同じStateのHit Regionはenabled interactionだけを参照する。crossfade中はRuntime stateから全Interactionを無効とする。

### 3.2 Artifact selection

各Render Surfaceの全reachable Stateは`empty`またはselected artifactをexactly once持つ。non-empty Stateのartifactは同じrenderer kindとcontract versionで解釈できる。DeliveryはRenderBundleのordered candidate列から最初のcompatible candidateを選び、順序変更、端末側再選択、暗黙downscale、renderer変更、crossfadeからcutへの変更をしない。

選択したartifactのID、kind、contract version、required features、asset descriptorはRenderBundleと一致する。Baked WebはPNG、sRGB、opaqueまたはstraight alphaの一つを必須とし、premultiplied alphaを拒否する。Native UIはtree、font closure、binding上限を満たす。v2のVideo profileはMP4、AVC High profile level 4.1以下、8-bit 4:2:0 progressive、alphaなしとする。Capability enumは将来のprofile識別用にVP9、AV1、alphaも予約するが、v2で受理するCapability Profileはこれらをsupported featureとして申告してはならず、artifactも使用してはならない。任意の音声は同じvideo内の単一AAC-LC object type 2 track、48 kHz、monoまたはstereoだけを許す。独立Audio Assetやaudio runtime stateは存在しない。Modelは自己完結GLBで、外部URI、runtime script、Unity component、root motionを拒否する。

`asset_access`のkey集合はselected artifact、font、video、modelが参照するAssetのtransitive closureと一致する。各Assetを一回、Asset ID順に持ち、descriptorはAssetSetと一致する。URLはabsolute HTTPS、expiryはmanifest生成時より後で、manifest自体のidentityには含めない。

### 3.3 Residency admission

Residency entryの集合はselected asset集合の対応kindと一致する。集計はchecked unsigned arithmeticで行う。

- Texture GPU chargeはunique checksumごとの`decoded_gpu_bytes`のsum、CPU chargeは`peak_load_cpu_bytes`のmax。
- Model encoded bytes、nodes、primitives、vertices、trianglesはunique checksumごとのsum。instance countはvisible ModelNode数、bone/morph/clipは上記のper-container最大値を使う。
- Native UIの`font_asset_ids`はselected Native UI artifactの全`ResolvedFont`が参照するAsset IDのunique集合をID順に持ち、`font_asset_count`はその集合に対応するunique checksum件数と一致する。glyph closureは各text sourceから、literalは実際のUnicode scalar、string variableは全allowed range、booleanは両label、numberはASCII `-0123456789.`、timerはASCII `0123456789:`を列挙する。string variableの集合には置換用U+0020とU+FFFD、`overflow=ellipsis`のtextにはU+2026も追加する。各scalarをprimary、fallback順で最初にsupportするFontFaceへ割り当て、`(font checksum, Unicode scalar)`で重複排除する。supportするfontがなければDeliveryをrejectする。`GlyphResidencyKey`はchecksumとscalarを持ち、font checksum昇順、同一font内はscalar数値昇順とする。件数を`max_glyphs`、font集合件数を`max_font_assets`と照合する。nodes、depth、text nodes、code pointsはartifactごとの実測値の最大をplanへ記録し、対応limitと照合する。
- Video bindingごとの`decoded_frame_bytes = width * height * 4`とし、portable decode surfaceをRGBA32一枚としてchecked unsigned arithmeticで算出する。encoded bytesはunique checksumのsum。decoder admissionは、presentation-owned Surfaceとcurrent Group-owned Surfaceだけを候補に、各Surfaceの到達可能Stateから選べるVideo artifactまたは非Video状態の直積を列挙する。各組合せではactive Video Surface instance一つをdecoder一つとして数え、同じchecksumの複数Surfaceも別decoderとする。全Groupと全組合せのcount最大値を`maximum_concurrent_decoders`、`decoded_frame_bytes`合計の最大値を`maximum_decoded_frame_bytes`とし、Capabilityの対応limit以下でなければならない。

集計値がmanifest記載値、Capability limit、artifact metadataのいずれかと一致しない場合、Manifest全体をrejectする。開始前に全assetをdownload、checksum検証、decode/import、GPU/decoder/font admissionし、`downloadReady`、`residentReady`、`sessionReady`を別々に管理する。すべて成立する前にControl inputを有効化しない。active Session中のselected checksumをpinし、residency喪失時は描画とinput送信を止めState/Controlを`FAILED_PRECONDITION / asset_residency_lost`で閉じる。

encoded cache admission、reservation共有、pin、LRU、staging leaseはADR-0012の式をそのまま適用する。cache missやevictionでprofile、artifact identity、runtime stateを変更しない。

## 4. Control / State 二接続

Controlはreliable、ordered、replayableで、Stateはlatest-wins、non-replayableである。各streamの最初のitemはHandshake exactly onceとし、それ以前の別payload、二回目のHandshake、空itemを`INVALID_ARGUMENT / handshake_order_invalid`で閉じる。

認証済みcontextだけがsession、participant、role、assignmentを所有する。client payloadからidentityやroleを採用しない。Control handshakeは`protocol_version="v2"`、progression `1`、required capability全件を満たす。State handshakeはControlで選択済みの値、connection IDと一致し、Controlが発行した32-byte nonceを30,000 ms以内に一回だけ使用する。nonceの再利用、別connection利用、expiryは`UNAUTHENTICATED / state_nonce_invalid`で閉じる。

serverはControl接続後に`ControlConnected`、Snapshot、State nonceの順に送る。Stateは`StateConnected`後、Control clientがSnapshotを適用して`StateReady`を送り、そのsequenceとorigin versionがcurrent cutに一致してからframeを送る。不一致は`FAILED_PRECONDITION / state_ready_fence_mismatch`とする。

### 4.1 Protocol limits

`RuntimeProtocolLimits`の全fieldはrequiredで、接続中に変更しない。baselineは次の値に固定する。

| Limit                      |                                                             値 |
| -------------------------- | -------------------------------------------------------------: |
| ID UTF-8 bytes             |                                                            128 |
| Control item               |                                                1,048,576 bytes |
| State item                 |                                                  262,144 bytes |
| Reliable event log         | 4,096件、8 MiB、900,000 msのいずれかの境界より古いeventをevict |
| Replay response            |                                                 1,024件、1 MiB |
| Catch-up queue             |                                                 1,024件、1 MiB |
| Idempotency retention      |                     1,024件、900,000 msのいずれかの境界でevict |
| Snapshot catch-up          |                                      初回を含む3回、合計250 ms |
| Runtime microsteps / drain |                                                          1,024 |
| State dependency buffer    |                                      4,096 field value、500 ms |
| Tracking samples / frame   |                                                              4 |
| Tracking frames / second   |                                                             90 |
| Anchor sample max age      |                                                         500 ms |

server implementationは上表の値を緩和・縮小せず、Handshakeで明示する。item byte上限とtracking rateはv2で上表の値に固定する。変更には新contractを必要とする。超過itemは`RESOURCE_EXHAUSTED / message_limit_exceeded`とする。Tracking rateはserver monotonic timeの各rolling 1,000 msで90 frameまでを受理し、超過frameをdropする。3つの連続するrolling windowで一件以上dropした場合は`RESOURCE_EXHAUSTED / state_rate_exceeded`でStateだけを閉じる。

### 4.2 Command とidempotency

PresenterだけがLogical Input、Surface Interaction、Runtime Controlを送れる。Viewer commandは`PERMISSION_DENIED / presenter_required`。origin version不一致はoutcomeを返さず`FAILED_PRECONDITION / presentation_origin_mismatch`でControlを閉じる。

`client_event_id`はSessionとparticipant範囲で接続をまたぐidempotency keyである。fingerprint bytesはASCII `unframe-command-v2`、NUL、command variant名、NULに続けて、`client_event_id`と診断用capture時刻を除く各stringをfield number順の`uint32 big-endian byte-length + UTF-8 bytes`、各enumを`uint32 big-endian`、各`uint64`をbig-endianで連結した値とする。fingerprintはそのSHA-256である。同じkey / fingerprintは保存済みOutcomeを返し、event、sequence、ingressを増やさない。異なるfingerprintでの再利用は`INVALID_ARGUMENT / idempotency_key_reused`で閉じる。

Logical InputとSurface InteractionはRuntimeがpaused、terminating、transitioningの場合、targetを探索する前に`RUNTIME_NOT_ACCEPTING_INPUT`とする。Logical inputが現在Stepで利用不能なら`INPUT_UNAVAILABLE`。Surfaceが未知、不可視、inactive、transition中、現在Stateでinteraction無効のいずれでも`INTERACTION_UNAVAILABLE`に丸める。これらのrejectはingress、Cue消費、cooldown、state、event sequenceを変更しない。

Runtime Controlはこのavailability判定の例外である。pauseはrunningから`paused/explicitPause`、resumeはpausedからinvariant、assignment lease、Publication fenceを再検証してrunning、endはrunning/pausedからterminatingへ遷移する。pause済みへのpause、runningへのresume、terminatingへの任意controlはそれぞれ`CommandNoOp`を返しeventを作らない。NoOpもidempotency windowへ保存する。

Accepted outcomeはcanonical input eventの受理だけを表し、その`canonical_event_id / reliable_sequence`は`LogicalInputAccepted`または`SurfaceInteractionAccepted`またはRuntime controlに対応する`RuntimeStatusChanged`を指す。Logical/Surface inputのaccepted outcomeはcue evaluationのexactly oneを持つ。候補なしは`CueNotSelected`、commit成功は`CueCommitted`、選択後のbatch rejectは`CueBatchRejected`と型付き理由を返す。batch rejectはCue消費、cooldown、resource state、Run、Reliable sequenceを変更せず、別Cueへfallbackしない。Runtime Controlではcue evaluationを禁止する。NoOpはcanonical event IDやsequenceを持たない。

## 5. Reliable Event、replay、projection

Reliable sequenceはsession-globalで正に単調増加する。Event IDはSession内で一意、cause IDは既存のcanonical eventを参照する。payload variant、fence、required IDが未知または不整合ならeventを適用せずConnection Resumeを開始する。

SurfaceTransitionStarted、Mediaの開始・pause・resume・seek、Model clipの開始・pause・resume・crossfade開始・完了は、event適用後の完全な`RuntimeRunSnapshot`を持つ。event内に同じtarget、Run ID、playback、durationを重複するfieldがある場合はsnapshotとbyte-exactまたは数値exactに一致しなければならない。client reducerはこのsnapshotでactive Run entryを置換でき、DeliveryされたFlow/Cue全体を必要としない。TimelineStartedはADR-0007で固定済みのowner、cause、completion、started timeから同じcomplete entryを構築する。

不可視eventはpayloadを送らず、次の可視event直前に一件の`ProjectionAdvance`へ集約する。`from_exclusive`はclient cursorと一致し、`through_sequence > from_exclusive`でなければならない。不可視eventしか増えていない間はmarkerを単独送信しない。

Replayは`after_sequence + 1`からcontiguousに返す。範囲外、projection、publication、originの変更時は`ResyncRequired`を一件送りlive deliveryを止める。同じstreamで部分replayと新Snapshotを混在させない。

同一logical timeのcanonical eventは次の順で処理する。

1. Surface transition、Timeline、Media、Model clipのcompletionをkindの上記列挙順、stable target ID、Run ID順。
2. TimerをCue ID順。
3. 外部ingressをingress sequence順。

一つのmutationが複数eventを生成する場合は、Run completion/cancel、resource commit、GroupExited、GroupEntered、StepEntered、PresentationEndedの順とする。Presentation終了ではTimeline、Media、ModelClipCanceledをRun ID順で確定した後にPresentationEndedを置く。Surface transition completionは派生Group/Step eventより先に置く。

`GroupEntered.initialization`はentry後の投影済みgroup-owned Node、Surface、Media、Variable、Model clip stateを各catalog key順にexactly once持つ。presentation-owned stateを重複しない。clientはこの集合をatomicに追加してからGroupEnteredを適用済みとし、Definitionのinitial valueを必要としない。GroupExitedではcatalogのownerが同じGroupである全stateをatomicに除去する。Snapshotでstateがないgroup-owned resourceはinactive/hiddenではなく未所有であり、描画、hit-test、Action targetにできない。presentation-ownedまたはcurrent Group-ownedなのにSnapshotからstateが欠ける場合はinvalid SnapshotとしてConnection Resumeする。

## 6. Snapshot、checkpoint、State frame

Canonical snapshotはShared Runtime Stateだけを持つ。participant、connection、projection、presence、tracking sample、edge detector、renderer artifact、URLを含めない。Projected snapshotはprofileのvisible closureだけを持ち、canonical restoreへ使用しない。

Snapshot cutはlogical time `T`以下の全internal completionを処理後、reliable sequence `S`のstate freezeと`S+1` subscriber登録を同じcritical sectionで行う。serializationとprojectionはlock外のimmutable valueだけを読む。catch-up overflowではpartial resultを捨て、新cutから初回を含む最大3回かつ合計250 msまで再試行し、超過は`RESOURCE_EXHAUSTED / snapshot_catch_up_exhausted`とする。

Durable checkpoint field 12だけは例外的にtyped `CanonicalRuntimeSnapshot`のdeterministic protobuf bytesを保持する。任意bytesではない。writerはunknown fieldを含めず、field 11は受信したfield 12そのものの`sha256:` hashとする。hash検証後にschema 2としてparseする。外側のsession、runtime、assignment、Publication、Definition/Bundle hashをロード対象の信頼済み値と照合し、外側の`reliable_sequence`と内側の同fieldを一致させる。内側ではRun ID assignment、owner epoch、catalog参照と全invariantを検証する。parse/re-serialize結果をhash sourceにしない。

recoveryは同じassignment epochでだけ行う。保存時にrunningでもclockを進めず`paused/processRecovered`へ変更する。active Runとarmed timerからscheduleを再構築し、contiguous event logでgapを埋められなければ`paused/recoveryGap`のまま継続を拒否する。

State frameはlatest-winsでreplayしない。keyframeは全visible latest-wins elementと全visible Anchor binding、deltaは前回送信後に変わったentryだけを持つ。frame sequenceは正に単調増加し、delta gap、fence不一致、`base_reliable_sequence`がControl適用cursorより新しい場合はframeを捨て、次のkeyframeを要求する。Timeline、Surface crossfade、Media、Model clipの毎frame補間値を送らない。

Node keyframe patchはactive、visible、opacity、transformの全fieldを持つ。delta patchは一つ以上の変更fieldを持つ。empty patch、同じframeのduplicate element ID、profile外Node、Timelineが現在所有するpropertyを含むpatchをrejectする。State mailboxはelement/field単位でlatest-wins mergeし、送信中のimmutable frameを書き換えない。

TrackingはPresenterのState streamだけが送れる。frame sequenceは正に単調増加、sample targetはduplicate-free、最大4件である。frameはfiniteでcanonicalな`presentation_from_quest_local` rigid Poseをrequiredで持つ。capture timestampは診断だけに使い、freshnessやcanonical ingress orderに使わない。Runtimeは同じframeのcalibrationでQuest-local poseをPresentation Spaceへ変換し、受理時のRuntime monotonic時刻をfreshness authorityとしてfresh sampleからtracking evaluatorをseedする。recovery直後のsampleで疑似edgeを生成しない。

Anchor patchはvisibleなAnchor-bound Node IDをkeyにし、`unavailable`または`sample`のexactly oneを持つ。sampleはfollowするposition/rotationだけをoptional fieldで持つ。500 msを超えたsample、cut/origin/assignment不一致をunavailableとし、対象Nodeを描画もhit-testもしない。別AnchorやStageへfallbackしない。

## 7. Runtime state とAction transaction

Runtime CoreだけがTrigger、Guard、Cue選択、Action、Run allocator、completionを確定する。一つのexternal inputまたはdue-event drainはArchitecture §12.9の順序に従い、1,024回目までのmicrostepを確定できる。1,025回目は評価・適用せず、それ以前の確定済みmutationを維持して`paused/microstepLimitExceeded`へ一つのatomic mutationで遷移する。

Action batchは全Actionと`next`をpre-event snapshotに対して解決し、property claimを作ってから一度だけcommitする。同一claim、active Runとの競合、型不一致、存在しないlive target、同じStateへのcrossfade、active transitionへのsetState、crossfade中のmodel clip要求が一つでもあれば全体をrejectする。Action配列順、last-write-wins、queue、interrupt、replaceで解決しない。永続化を含むcommit失敗はstate/eventを公開せず`paused/atomicCommitFailed`にする。

Published artifact上存在すべきtargetや型がRuntimeで欠落する場合は入力rejectではなくinvariant faultである。RuntimeStatusChangedを確定し、以後Presenterの明示resumeと再検証まで新規inputを受理しない。

### 7.1 Progression とresource lifetime

Presentation開始時にpresentation-owned stateを一度初期化し、initial Groupへentryする。最初に接続するclientは完成後のConnection Snapshotを受け、初期化event列のreplayを必要としない。Group entryでepochを増やし、group-owned Node、Surface、Variable、Media、Model clipをDefinition初期値へresetし、initial Step entryでstep epochを増やす。inactive GroupのstateをSnapshotに残さない。

Group exitはInteraction無効化、group-owned non-blocking Runのcancel、Node deactivate、group-owned state破棄、GroupExitedの順。presentation-owned stateとRunは維持する。Step exitではStepExecutionを破棄するが、Runはowner規則に従う。

blocking Run中はphaseをtransitioningにし、通常inputを評価しない。期限に達したTimerはfiredにするがCueを評価・再試行しない。Run completionはstateとblocking setだけを更新し、completion Triggerから新Cueを開始しない。最後のblocking Run後にpending nextを一度適用する。

### 7.2 Surface transition

CutはRunを作らずStateをatomicに変更する。同じStateへのcutはeventなしの成功no-op。Crossfadeは正のdurationを持つblocking Runで、受理時点でcanonical Stateを遷移先へ変更する。active transition中の追加setStateと同じStateへのcrossfadeをrejectする。

`u = clamp((runtimeTime - startedAt) / duration, 0, 1)`とし、旧weightは`1-easing(u)`、新weightは`easing(u)`。deadlineは`startedAt + duration`でchecked additionする。完了時にRunとtransition IDを除去してInteractionを有効化する。Renderer acknowledgementをcompletion sourceにしない。

### 7.3 Timeline

Timeline local timeは`t = clamp(runtimeTime - startedAt, 0, duration)`。easing、Vector、Quaternion補間はADR-0007の式をexactに用いる。completionでは全track終値をNode stateへ一transactionでcommitしてRunを除去する。explicit stopとGroup exitは停止時`t`の値をcommitする。Presentation endは値をcommitせずcancelする。inactive stopはeventなしの成功no-opである。

### 7.4 Video media

Media playbackのraw位置はplaying時に`raw = positionAtReference + (runtimeTime-referenceRuntimeTime)`、paused時に固定positionとする。loopなら`position = raw mod duration`、non-loopなら`position = clamp(raw, 0, duration)`とする。Global pauseはlogical clock停止だけで表す。play中へのplay、paused中へのpauseは成功no-op、停止状態へのpauseはbatch rejectとする。停止状態へのplayは`MediaStoppedState.held_position_ms`から新しいRunとして開始する。`media.seek.positionSeconds`はActionValue解決後にfiniteかつnon-negativeを検査し、`position_ms = positionSeconds * 1000`をbinary64のまま求める。`0..duration`だけを受理し、playingなら同じruntime timeへrebase、pausedなら固定位置を置換する。停止状態へのseekはRunを作らず、`MediaStoppedState.held_position_ms`をseek位置へ置換する。explicit stopは現在位置を`MediaStopped.held_position_ms`と`MediaStoppedState.held_position_ms`へ保存する。自然完了は`MediaCompleted.held_position_ms = duration`を通知し、同じevent適用で`MediaStoppedState.held_position_ms = 0`へresetするため、seekを挟まない再playは位置`0`から始まる。

非loop動画がdurationへ達したらRunを除去し最終位置を保持してMediaCompletedを一度生成する。loop動画は`position mod duration`で継続し自然完了しない。Group exitはRunをcancelしてgroup stateを破棄する。Presentation endでは値をcommitせずcancelする。音声trackは同じposition、pause、seek、loopに従う。

### 7.5 Model clip

ModelNodeごとの状態は次のexactly oneである。

- `default_pose`
- `held_clip(clipId, position)`
- `held_blend(from clip/position, to clip/position, toWeight)`
- `active(runId)`。対応するactive Runはsingleまたはcrossfade。

single playback位置は、playingなら`raw = positionAtReference + (runtimeTime-referenceRuntimeTime) * speed`、pausedなら固定positionとする。speedはfiniteかつ正。loopは`raw mod duration`、non-loopは`clamp(raw, 0, duration)`。non-loopがdurationへ達するとRunを除去し最終`held_clip`を保存し、ModelClipCompletedを一度生成する。

cut play actionはdefault、held_clip、held_blend、active singleから即時切替でき、既存Runがあれば停止時姿勢の中間commitを公開せず同じtransaction内で新しいRun IDへ置換する。crossfadeはheld_clipまたはactive singleからだけ開始でき、active singleも新しいRun IDへ置換する。`conflict: reject`はactive crossfadeまたは同じbatchで同一`modelClip(modelNodeId)` claimへ複数操作がある場合をrejectする意味であり、明示したcutによるactive singleの置換を禁止しない。`modelClip(modelNodeId)`と`nodeField(modelNodeId, transform/opacity/visible)`は独立claimなので、TimelineによるModelNodeのTRS/opacity変更とclip内部姿勢の再生は同時に許す。defaultをsourceにするcrossfadeは禁止し、最初のplayはcutだけを許す。held_blendまたはactive crossfadeからcrossfadeを要求すると常にbatch rejectする。

Crossfade source/targetそれぞれのclip位置を上の式で評価する。`transitionElapsedAtReference = transition_clock.playing.position_at_reference_ms`、`transitionReference = transition_clock.playing.reference_runtime_time_ms`として、`u = clamp((transitionElapsedAtReference + runtimeTime-transitionReference)/duration, 0, 1)`、target weight=`easing(u)`とする。paused中は`transitionElapsedAtReference = transition_clock.paused.position_ms`として`u`を固定する。pauseは現在elapsedを`transition_clock.paused.position_ms`へ保存し、resumeは同じ値を`transition_clock.playing.position_at_reference_ms`へ保存して`reference_runtime_time_ms`だけを現在runtime timeへ更新する。`from_is_held=true`はheld_clipから開始したsourceを表し、その`from.playback`は常に`PausedClock`で固定する。`from_is_held=false`のsourceとtargetだけをpause/resume時にrebaseする。常に二クリップ以下で、layer、mask、additive、root motionは適用しない。source clipが先に自然終端へ達しても独立したcompleted eventを生成せず、終端poseをfade完了まで保持する。non-loop targetが先に自然終端へ達した場合も終端poseを保持し、fade完了時にまずModelClipCrossfadeCompletedを生成して同じRun IDをsingle targetへ遷移し、同じlogical tick内の直後にModelClipCompletedを生成してRunを除去し`held_clip`を保存する。

pauseはsingleなら現在clip位置、crossfadeなら進行中のclip位置と現在transition elapsedを各`PausedClock`へrebaseしRunを保持する。resumeは同じ値を現在runtime time基準の`PlayingClock`へrebaseする。`from_is_held=true`のsourceは両操作で固定したままとする。既にpausedへのpause、playingへのresumeはeventなし成功no-op。

pause/resumeはactive Runにだけ適用でき、default、held_clip、held_blendではbatch rejectする。stopはactive single/crossfadeに上記規則を適用し、defaultまたはheld状態ではeventなし成功no-opとする。`loop=true`かつ`completion=blocking`は自然にblocking setを解除できないためbuild errorとし、loop Runはnon-blockingだけを許す。non-loop blocking Runは自然終了までblockingで、transitioning中の別Cueからpause/stopできない。Session全体のpause/resumeはlogical clockを止めるだけで個別Run phaseを変更しない。

explicit stopはsingleなら`held_clip`、crossfadeなら両clipの現在位置と現在target weightを`held_blend`に保存してRunを除去する。held_blendから新crossfadeは禁止し、cut playだけで抜けられる。自然終了、停止、crossfade完了のstale callbackはRun ID、assignment、owner epoch不一致なら無視する。

Group exitはgroup-owned Runを`ModelClipCanceled/GROUP_EXIT`として除去した後にNode stateごと破棄する。Presentation endは保持姿勢をcommitせず、全active model RunをRun ID順に`ModelClipCanceled/PRESENTATION_ENDED`として除去する。これらを明示停止の`ModelClipStopped`と混同しない。

Model clipは骨格内部だけを評価し、ModelNode Transformを変更しない。素材のroot motionが除去済みであることをDelivery前に検証する。異なるModelNodeは独立して同時再生できる。

## 8. gRPC status とstable reason

| Status                | reason                           | 条件                                     |
| --------------------- | -------------------------------- | ---------------------------------------- |
| `INVALID_ARGUMENT`    | `handshake_order_invalid`        | handshake順、空payload、重複handshake    |
| `INVALID_ARGUMENT`    | `message_invalid`                | required presence、enum、range、参照不能 |
| `INVALID_ARGUMENT`    | `idempotency_key_reused`         | keyを別fingerprintで再利用               |
| `UNAUTHENTICATED`     | `authentication_required`        | 認証なし・期限切れ                       |
| `UNAUTHENTICATED`     | `state_nonce_invalid`            | nonce不正、期限切れ、再利用              |
| `PERMISSION_DENIED`   | `presenter_required`             | Viewerがcommand/tracking送信             |
| `FAILED_PRECONDITION` | `protocol_incompatible`          | version/capability不一致                 |
| `FAILED_PRECONDITION` | `publication_fence_mismatch`     | Publication不一致                        |
| `FAILED_PRECONDITION` | `presentation_origin_mismatch`   | input origin不一致                       |
| `FAILED_PRECONDITION` | `state_ready_fence_mismatch`     | StateReady cut不一致                     |
| `FAILED_PRECONDITION` | `asset_residency_lost`           | active asset residency喪失               |
| `RESOURCE_EXHAUSTED`  | `reliable_subscriber_slow`       | reliable送信queue上限                    |
| `RESOURCE_EXHAUSTED`  | `snapshot_catch_up_exhausted`    | Snapshot再試行上限                       |
| `RESOURCE_EXHAUSTED`  | `message_limit_exceeded`         | item byte上限                            |
| `RESOURCE_EXHAUSTED`  | `state_rate_exceeded`            | 継続的State rate超過                     |
| `UNAVAILABLE`         | `runtime_assignment_unavailable` | assignmentへ到達不能                     |

status codeは標準`grpc-status`で返す。reasonはtrailing metadata key `unframe-reason`の単一ASCII lower-snake valueとして表の値を返す。同じresponseにこのkeyを複数付与してはならない。`grpc-message`は診断専用で、その本文の解析をcontractにしない。`CommandRejected`は回復可能な入力結果だけに使い、認証、role、fence、protocol、idempotency違反を丸めない。

## 9. 完了条件

実装はProto descriptor compileに加え、JSON/Proto parity、deterministic binary fixture、全enum/oneof fail-closed、Delivery closureとbudget境界、replay gap、Snapshot cut、idempotency、Action transaction、Surface/Timeline/Video/Model clipの状態遷移、pause/recovery、State frame gapを同じfixtureで検証する。生成Go/C# client接続とUnity実機budget計測は別作業だが、ここで定義したfieldや挙動をconsumer判断で変更しない。
