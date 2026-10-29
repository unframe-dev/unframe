# Presentation Delivery / Runtime contract

- **Status**: Normative contract（Presenter authority v3）
- **Wire source**: `packages/contracts/proto/unframe/{presentation,delivery,realtime}/`
- **Related**: [Architecture](./ARCHITECTURE.md), [Data model](./DATA_MODEL.md), [ADR-0007（アーカイブ）](../decisions/archived/0007-timeline-runtime-run-wire-contract.md), [ADR-0008（アーカイブ）](../decisions/archived/0008-runtime-transport-contract.md), [ADR-0009](../decisions/0009-semantic-tree-hit-region-contract.md), [ADR-0010](../decisions/0010-spatial-surface-coordinate-contract.md), [ADR-0011](../decisions/0011-surface-partition-contract.md), [ADR-0012](../decisions/0012-texture-budget-residency-contract.md), [ADR-0015](../decisions/0015-presentation-definition-artifact-boundaries.md), [ADR-0016](../decisions/0016-model-animation-scope.md)

この文書は Delivery と Runtime の presence、検証、状態遷移、失敗結果を固定する。Presenter 認識・入力同期・凍結 Anchor・Step 復元を v3 の正本 schema と生成 consumer に接続した。version・fingerprint・入力同期・容量の詳細は [Presenter authority contract](./CONTRACT_PRESENTER_AUTHORITY.md) を正本とする。旧 major の公開物・checkpoint・入力方式への adapter や downgrade は持たない。Presenter authority の移行記録は[移行計画](../plans/presenter-recognition-runtime-authority-refactor.md)、非同期保存・複数 Session・障害復旧の受け入れ条件と公開環境での未検証事項は[Runtime 再設計計画](../plans/realtime-runtime-redesign.md)を参照する。

## 1. Version と数値

有効な version の組合せは次の一つである。RenderBundle / AssetSet は2、Renderer / Model は1を維持する。

| 項目                                   |           値 |
| -------------------------------------- | -----------: |
| Delivery schema / contract             |    `3` / `3` |
| Capability schema                      |          `3` |
| Runtime protocol / contract            | `"v3"` / `3` |
| Progression contract                   |          `2` |
| Projection contract                    |          `2` |
| Projected runtime catalog contract     |          `3` |
| Connection / canonical snapshot schema |          `3` |
| Durable checkpoint schema              |          `3` |

同じ major 内で未知の通常fieldはwire decoderが保持または無視してよい。ただしrequired `oneof`は、同じmessageに未知fieldが共存していても既知variantが一つもdecodeされなければ空oneofとしてrejectする。これにより未知variantを既知messageとして誤適用しない。未知の enum 値、未知の required capability、上表と異なるversionも解釈せずfail closedにする。required fieldやvariantを増やす変更は新majorを必要とする。

Protoの`uint32`は`0..4_294_967_295`、`uint64`は`0..18_446_744_073_709_551_615`である。JSONへ変換するconsumerはすべての整数を`0..9_007_199_254_740_991`に制限し、超過をrejectする。JSON numberをwireへ変換する際はfinite、integer、non-negative、安全整数を順に検証する。`double`はfiniteでなければならず、`NaN`、正負Infinity、`-0`をrejectする。ただし次段落のMedia/Model clip sample positionだけは入力境界で`-0`を`0`へcanonicalizeして受理する。

logical runtime time、duration、deadline、retention、expiryは非負の整数millisecondであり、duration、retention、expiryは明記がない限り正とする。Videoのdurationは成果物契約のpacket-end規則に従い有理数からミリ秒へ切り上げる。その他の素材durationをCompilerが秒から変換する場合、binary64で`seconds * 1000`を計算しhalf-away-from-zeroで整数化し、正のdurationが`0`へ丸められた場合は`1`へclampする。Media/Model clipのsample positionだけは速度適用後の正確な位置を保つfiniteな`double` millisecondとし、`-0`を`0`へcanonicalizeする。sample positionを整数へ丸めない。

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

`CapabilityProfile`のversionsは`delivery=3 / runtime=3 / progression=2 / projection=2`で固定する。`supported=false`のrenderer/modelはcontract version `1`と空feature集合を持ち、対応するartifactを選択できない。`supported=true`ではcontract version `1`、そのkindが必要とするfeature、正のlimitを必須とする。Model formatは`GLTF_BINARY`だけを許す。WebView、embedded HTML/JS/Wasm、独立音声のcapabilityや予約値を追加しない。

すべてのlimitとtier IDはrequiredである。`TextureLimits`、`NativeUiLimits`、`VideoLimits`、`ModelLimits`の数値は正でなければならない。`encoded_cache_reserve_bytes < max_encoded_cache_bytes`を要求する。`max_blended_clips_per_model`はcapabilityによらず`2`、通常時は`1`であり、layer、mask、additive blendを表すfieldは存在しない。

Limitの集計単位は次に固定する。Texture width/height/pixelsは一texture、bindingsとGPU bytesはprofile全体のunique selected texture、serial CPUは一textureのmax、encoded cacheは全selected Assetで判定する。Native UI node/depth/text/code pointは一artifact、glyphとfont Assetはprofile全体のunique集合で判定する。Video width/height/pixelsは一video、encoded bytesはunique selected videoのsum、decoded frame bytesは同時decoder instance集合のsumである。Model Asset数とencoded bytesはunique checksum、instanceはvisible ModelNode数、nodes / primitives / vertices / trianglesはModelNodeごとに展開した合計、bonesは一skin、morph targetは一primitive、animation clipは一Assetの上限である。

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

Residency entryの集合はselected asset集合の対応kindと一致する。Video planは動画がない場合も空のplanを必須とし、Delivery受け入れ時に対応Assetと予算集計を検証する。集計はchecked unsigned arithmeticで行う。

- Texture GPU chargeはunique checksumごとの`decoded_gpu_bytes`のsum、CPU chargeは`peak_load_cpu_bytes`のmax。
- Model bindingはselected Asset IDごとに保持する。assets数とencoded bytesはunique checksum、nodes / primitives / vertices / trianglesはvisible ModelNodeごとのdescriptorをinstance展開して合計する。instance countはvisible ModelNode数、bone/morph/clipは上記のper-container最大値を使う。
- Native UIの`font_asset_ids`はselected Native UI artifactの全`ResolvedFont`が参照するAsset IDのunique集合をID順に持ち、`font_asset_count`はその集合に対応するunique checksum件数と一致する。glyph closureは各text sourceから、literalは実際のUnicode scalar、string variableは全allowed range、booleanは両label、numberはASCII `-0123456789.`、timerはASCII `0123456789:`を列挙する。string variableの集合には置換用U+0020とU+FFFD、`overflow=ellipsis`のtextにはU+2026も追加する。各scalarをprimary、fallback順で最初にsupportするFontFaceへ割り当て、`(font checksum, Unicode scalar)`で重複排除する。supportするfontがなければDeliveryをrejectする。`GlyphResidencyKey`はchecksumとscalarを持ち、font checksum昇順、同一font内はscalar数値昇順とする。件数を`max_glyphs`、font集合件数を`max_font_assets`と照合する。nodes、depth、text nodes、code pointsはartifactごとの実測値の最大をplanへ記録し、対応limitと照合する。
- Video bindingごとの`decoded_frame_bytes = width * height * 4`とし、portable decode surfaceをRGBA32一枚としてchecked unsigned arithmeticで算出する。encoded bytesはunique checksumのsum。decoder admissionは、presentation-owned Surfaceとcurrent Group-owned Surfaceだけを候補に、各Surfaceの到達可能Stateから選べるVideo artifactまたは非Video状態の直積を列挙する。各組合せではactive Video Surface instance一つをdecoder一つとして数え、同じchecksumの複数Surfaceも別decoderとする。全Groupと全組合せのcount最大値を`maximum_concurrent_decoders`、`decoded_frame_bytes`合計の最大値を`maximum_decoded_frame_bytes`とし、Capabilityの対応limit以下でなければならない。

集計値がmanifest記載値、Capability limit、artifact metadataのいずれかと一致しない場合、Manifest全体をrejectする。開始前に全assetをdownload、checksum検証、decode/import、GPU/decoder/font admissionし、`downloadReady`、`residentReady`、`sessionReady`を別々に管理する。すべて成立する前にControl inputを有効化しない。active Session中のselected checksumをpinし、residency喪失時は描画とinput送信を止めState/Controlを`FAILED_PRECONDITION / asset_residency_lost`で閉じる。

encoded cache admission、reservation共有、pin、LRU、staging leaseはADR-0012の式をそのまま適用する。cache missやevictionでprofile、artifact identity、runtime stateを変更しない。

## 4. Control / State 二接続

Controlはreliable、ordered、replayableで、Stateはlatest-wins、non-replayableである。各streamの最初のitemはHandshake exactly onceとし、それ以前の別payload、二回目のHandshake、空itemを`INVALID_ARGUMENT / handshake_order_invalid`で閉じる。

認証済みcontextだけがsession、participant、role、assignmentを所有する。client payloadからidentityやroleを採用しない。Control handshakeは`protocol_version="v3"`、progression `2`、required capability全件を満たす。State handshakeはControlで選択済みの値、connection IDと一致し、Controlが発行した32-byte nonceを30,000 ms以内に一回だけ使用する。nonceの再利用、別connection利用、expiryは`UNAUTHENTICATED / state_nonce_invalid`で閉じる。

初回Control接続では`ControlConnected`、Snapshot、State nonceの順に送る。resumeではSnapshotの代わりにReliable replayを送り、その後State nonceを送る。Stateは`StateConnected`後、Control clientがSnapshotまたはreplayを適用して`StateReady`を送り、そのsequenceとorigin versionが接続のcutに一致してからframeを送る。初回のcutは送信Snapshotのcut、resumeのcutは最後に送信した投影済みreplay eventのcursorであり、replayが空ならresume cursorを維持する。hidden eventだけによるcanonical sequenceの進行をcutへ含めない。不一致は`FAILED_PRECONDITION / state_ready_fence_mismatch`とする。Stateだけが切断した場合はattachmentとreadyを解除し、生存するControlで新しいsingle-use nonceを発行する。再接続したStateは`StateConnected`の後、Control接続のcutに対する`StateReady`を再度必要とする。

### 4.1 Protocol limits

Reliable log / Replay / State buffer の上限は従来値を維持する。command history は時間・件数による eviction を廃止し、[v3 の容量と同期 ACK](./CONTRACT_PRESENTER_AUTHORITY.md#容量と超過時の動作)に従う。

`RuntimeProtocolLimits`の全fieldはrequiredで、接続中に変更しない。baselineは次の値に固定する。

| Limit                      |                                                             値 |
| -------------------------- | -------------------------------------------------------------: |
| ID UTF-8 bytes             |                                                            128 |
| Control item               |                                                1,048,576 bytes |
| State item                 |                                                  262,144 bytes |
| Reliable event log         | 4,096件、8 MiB、900,000 msのいずれかの境界より古いeventをevict |
| Replay response            |                                                 1,024件、1 MiB |
| Catch-up queue             |                                                 1,024件、1 MiB |
| Command history            |                1,024件、262,144 bytes。上限前の同期 ACK で整理 |
| Snapshot catch-up          |                                      初回を含む3回、合計250 ms |
| Runtime microsteps / drain |                                                          1,024 |
| State dependency buffer    |                                      4,096 field value、500 ms |
| Tracking samples / frame   |                                                              4 |
| Tracking frames / second   |                                                             90 |
| Anchor sample max age      |                                                         500 ms |

server implementationは上表の値を緩和・縮小せず、Handshakeで明示する。item byte上限とtracking rateは上表の値に固定する。変更には新contractを必要とする。超過itemは`RESOURCE_EXHAUSTED / message_limit_exceeded`とする。Tracking rateはserver monotonic timeの各rolling 1,000 msで90 frameまでを受理し、超過frameをdropする。3つの連続するrolling windowで一件以上dropした場合は`RESOURCE_EXHAUSTED / state_rate_exceeded`でStateだけを閉じる。

### 4.2 Command とidempotency

`PresentationOriginChanged`自身のevent fenceは変更前のorigin versionを持つ。payloadのorigin versionは直前値から1だけ進め、clientはevent適用後に保持fenceを更新する。後続event / State frameは更新後のversionを使う。resumeは更新後のfenceを送り、古いoriginのState frameを破棄する。

PresenterだけがLogical / Surface / Gesture / Zone InputとRuntime Controlを送れる。client 起点の System event を許可せず、送信者は認証情報から Runtime が設定する。Viewer commandは`PERMISSION_DENIED / presenter_required`。origin version不一致はoutcomeを返さず`FAILED_PRECONDITION / presentation_origin_mismatch`でControlを閉じる。

`client_event_id` は `<command_epoch>:<小文字UUID v4>` とし、Session / participant 内の idempotency key とする。fingerprint は `unframe-command-v3` と variant、ID、epoch、origin、入力文脈、payload から算出し、診断用時刻を含めない。[正確な encoding](./CONTRACT_PRESENTER_AUTHORITY.md#fingerprint)に従う。同じ実行世代の同じ ID・内容には確定済み Outcome を返し、異内容の再利用は `INVALID_ARGUMENT / idempotency_key_reused` で閉じる。

Gesture・Zone・ボタン・Surface 入力を、認識開始時の Group / Step、Step 入場世代、server 管理の入力世代、イベント ID に拘束する。送信時に現在の Step へ付け替えない。新規入力は現在の Step・世代・実行状態を検証し、client 時刻での並べ替え、過去への遡及評価、追加の経過時間による有効期限を設けない。Step 入場・再入場・選択、pause / resume、切断からの復旧、再校正で入力世代を更新し、途中の認識を破棄する。再校正後は server と世代を同期してから認識を再開する。

通常再送は同じ ID と内容を使う。認証・Session 等の拘束を検証した後、同じ実行世代の確定済み Outcome を現在の Step・世代に対する新規入力判定より先に返す。同じ ID の異なる内容は拒否する。未確認 Outcome を保持し、上限に達する前に新規入力受付を止める。状態同期、新しい入力世代への切替、client の古い送信待ち操作の破棄を確認してから旧記録を整理し、記録消去を理由に古いイベントを再実行しない。切断復旧は未処理操作を持ち越さず確定状態へ同期し、長時間切断に対する厳密な再送期限は設けない。

Logical InputとSurface InteractionはRuntimeがpaused、terminating、transitioningの場合、targetを探索する前に`RUNTIME_NOT_ACCEPTING_INPUT`とする。Logical inputが現在Stepで利用不能なら`INPUT_UNAVAILABLE`。Surfaceが未知、不可視、inactive、transition中、現在Stateでinteraction無効のいずれでも`INTERACTION_UNAVAILABLE`に丸める。これらのrejectはingress、Cue消費、state、event sequenceを変更しない。

Runtime Control は通常入力の availability 判定と Step 一致条件を適用しない。Presenter 権限と実行状態を検証し、pause / resume / end / selectStep / recalibrate を扱う。running から pause、paused から resume、running / paused から end とする。同状態への pause / resume と終了後の pause / end は NoOp を保存する。終了後の resume / selectStep は `SESSION_ENDED`、未到達 Step は `STEP_NOT_REACHED` を返す。Step 選択の復元規則は §7.1 に従う。

Accepted outcomeはcanonical input eventの受理だけを表し、その`canonical_event_id / reliable_sequence`は`LogicalInputAccepted` / `SurfaceInteractionAccepted` / `GestureInputAccepted` / `ZoneInputAccepted`、または全体操作の `RuntimeStatusChanged` / `RuntimeViewReplaced`を指す。通常入力の accepted outcomeはcue evaluationのexactly oneを持つ。候補なしは`CueNotSelected`、commit成功は`CueCommitted`、選択後のbatch rejectは`CueBatchRejected`と型付き理由を返す。batch rejectはCue消費、resource state、Run、Reliable sequenceを変更せず、別Cueへfallbackしない。Runtime Controlではcue evaluationを禁止する。NoOpはcanonical event IDやsequenceを持たない。

## 5. Reliable Event、replay、projection

Reliable sequence は Session の同じ assignment epoch 内で正に単調増加する。Event ID も同じ実行世代内で一意とし、cause ID はその世代の既存 canonical event を参照する。新 assignment epoch の復旧では最後の checkpoint まで sequence が後退し得る。同じ fence 内の sequence 後退と Event ID 再利用は拒否する。payload variant、fence、required IDが未知または不整合ならeventを適用せずConnection Resumeを開始する。

SurfaceTransitionStarted、Mediaの開始・pause・resume・seek、Model clipの開始・pause・resume・crossfade開始・完了は、event適用後の完全な`RuntimeRunSnapshot`を持つ。event内に同じtarget、Run ID、playback、durationを重複するfieldがある場合はsnapshotとbyte-exactまたは数値exactに一致しなければならない。client reducerはこのsnapshotでactive Run entryを置換でき、DeliveryされたFlow/Cue全体を必要としない。TimelineStartedは[Realtime Protobuf](../../packages/contracts/proto/unframe/realtime/realtime.proto)のowner、cause、completion、started timeから同じcomplete entryを構築する。

不可視eventはpayloadを送らず、次の可視event直前に一件の`ProjectionAdvance`へ集約する。`from_exclusive`はclient cursorと一致し、`through_sequence > from_exclusive`でなければならない。不可視eventしか増えていない間はmarkerを単独送信しない。

Replayは`after_sequence + 1`からcontiguousに返す。範囲外、projection、publication、originの変更時は`ResyncRequired`を一件送りlive deliveryを止める。同じstreamで部分replayと新Snapshotを混在させない。

同一logical timeのcanonical eventは次の順で処理する。

1. Surface transition、Timeline、Media、Model clipのcompletionをkindの上記列挙順、stable target ID、Run ID順。
2. TimerをCue ID順。
3. 外部ingressをingress sequence順。

一つのmutationが複数eventを生成する場合は、Run completion/cancel、resource commit、GroupExited、GroupEntered、StepEntered、PresentationEndedの順とする。Presentation終了ではTimeline、Media、ModelClipCanceledをRun ID順で確定した後にPresentationEndedを置く。Surface transition completionは派生Group/Step eventより先に置く。

`GroupEntered.initialization`はentry後の投影済みgroup-owned Node、Surface、Media、Variable、Model clip stateを各catalog key順にexactly once持つ。presentation-owned stateを重複しない。clientはこの集合をatomicに追加してからGroupEnteredを適用済みとし、Definitionのinitial valueを必要としない。GroupExitedではcatalogのownerが同じGroupである全stateをatomicに除去する。Snapshotでstateがないgroup-owned resourceはinactive/hiddenではなく未所有であり、描画、hit-test、Action targetにできない。presentation-ownedまたはcurrent Group-ownedなのにSnapshotからstateが欠ける場合はinvalid SnapshotとしてConnection Resumeする。

## 6. Snapshot、checkpoint、State frame

Canonical snapshotはShared Runtime Stateだけを持つ。participant、connection、projection、presence、raw tracking sample、認識器の内部状態、renderer artifact、URLを含めない。pause 時に確定した凍結 Anchor 表示状態と §7.1 の Step 開始状態履歴を Snapshot / checkpoint の共有状態に含める。開始状態履歴全体は Viewer へ投影しない。Projected snapshotはprofileのvisible closureだけを持ち、canonical restoreへ使用しない。

Snapshot cutはlogical time `T`以下の全internal completionを処理後、reliable sequence `S`のstate freezeと`S+1` subscriber登録を同じcritical sectionで行う。serializationとprojectionはlock外のimmutable valueだけを読む。catch-up overflowではpartial resultを捨て、新cutから初回を含む最大3回かつ合計250 msまで再試行し、超過は`RESOURCE_EXHAUSTED / snapshot_catch_up_exhausted`とする。再試行対象はSnapshotの投影・serializationの準備中のoverflowであり、初回Snapshot送信開始後のqueue overflowは`reliable_subscriber_slow`で接続を終了する。

Durable checkpoint field 12だけは例外的にtyped `CanonicalRuntimeSnapshot`のdeterministic protobuf bytesを保持する。任意bytesではない。writerはunknown fieldを含めず、field 11は受信したfield 12そのものの`sha256:` hashとする。hash検証後にschema 3としてparseする。外側のsession、runtime、assignment、Publication、Definition/Bundle hashをロード対象の信頼済み値と照合し、外側の`reliable_sequence`と内側の同fieldを一致させる。内側ではRun ID assignment、owner epoch、catalog参照と全invariantを検証する。parse/re-serialize結果をhash sourceにしない。

Durable checkpoint の `recovery_payload` は Session 開始日時、過去の参加者と role、command epoch・入力同期状態、整理前の command key・fingerprint・Outcome を持つ `RuntimeRecoveryMetadata` の deterministic protobuf bytes とする。`recovery_hash`はその生bytesの`sha256:` hashであり、parse前に検証する。両fieldは一組で扱い、canonical stateやProjected snapshotには含めない。Runtimeによる復旧はこのmetadataを必須とし、欠落したcheckpointを拒否する。Canonical state と復旧 metadata を同じ immutable cut から保存する。同じ実行世代内の再送ではメモリ上の確定済み Outcome を返し、Action を再実行しない。

通常 mutation は状態・入力 fingerprint・Outcome・Reliable sequence をメモリ上で一体として確定し、checkpoint 保存を待たずに公開する。入力同期 READY も保存完了を保証しない。変更のある Session は1秒間隔で保存を試み、Session ごとの worker は送信中の一件と未送信の最新候補までを保持する。新しい完全な cut で未送信候補を置き換える。checkpoint version は候補ごとに増加し、破棄候補による欠番を許す。同一要求の retry は payload・version・idempotency key を変えず、保存は Session ごとに直列化する。Host 全体にも同時保存数の上限を設ける。

保存失敗・遅延だけでは通常進行・入力受付・配信を止めず、適用済み操作を rollback したり保存エラーへ変更したりしない。5秒などの遅延による自動 pause は設けない。一時的失敗は backoff 付きで retry し、権限・世代違反は無条件に retry しない。最終保存成功時刻、保存済み / 現在の Reliable sequence、失敗・retry 状態を Session ごとに観測する。1秒は保存試行の間隔であり、復旧データの古さに上限を保証しない。同一プロセスが生存している間の再接続では現在のメモリ状態を使う。容量・状態不変条件・認証・assignment lease の検証は維持する。

### Cloud Host と実行世代

Cloud Host は一つの endpoint と常駐プロセスで複数 Session を扱う。Control Plane の有効な割り当てだけを読み込み、native gRPC は検証済み JWT、ブラウザ WebSocket は最初の認証 message の検証結果から Session を選ぶ。未検証の要求で Session を生成しない。各 Session が状態・直列処理・接続・nonce・replay・保存 worker・assignment guard を所有する。

Host は起動登録で boot ID・起動時刻・明示 capacity を送り、Control Plane が発行する generation を以降の heartbeat に拘束する。heartbeat は Session ごとの assignment epoch と実行状態を報告し、担当 assignment 一覧を受け取る。新規受付 / drain と担当 Session の lease 更新を分離し、満員・drain 中も既存の lease を更新する。Host の生存と各 Session の readiness を分け、旧 boot generation の管理要求を拒否する。Session の `Waiting / Presenting / Ended` と Runtime の実行状態は別に管理する。接続者ゼロだけでは終了・アンロードせず、終了・明示解放・Host 停止時に実行資源を解放する。

実行状態を作り直すたび、同じ Host で旧 lease が残っていても新しい assignment epoch を取得する。旧実行の停止を確認できない場合は旧 lease の失効を待つ。heartbeat の途絶や Control Plane 側の epoch 更新だけでは停止確認にならない。終了済み・明示解放済み・別 Host へ移動済み・履歴が曖昧な割り当てを自動で取り戻さない。

### 復旧と終了の保存境界

Control Plane の bootstrap は、保存済み checkpoint の version・Reliable sequence・保存元 assignment・固定 publication を検証し、保存元 runtime ID / kind・assignment epoch・checkpoint sequence を `checkpointSource` として返す。Runtime は保存元 fence で hash・cut・参照を検証し、全 Run ID と参照を新 epoch へ付け替え、現在の catalog と fence でも検証する。Session・publication・Definition / Bundle hash は変更しない。破損 checkpoint を初期状態で代替しない。

復旧では保存済みの進行位置・時計・再生位置・履歴へ戻し、停止していた実時間を加算せず `paused / processRecovered` とする。既存の `invariantViolation` による停止理由は維持する。checkpoint が存在しない場合だけ初期状態へ戻し、その復旧も paused / processRecovered として初回起動と区別する。最初の参加前の復旧 checkpoint は、Reliable sequence が0で操作履歴も空の場合に限り参加者履歴を空にできる。新 fence の復旧 checkpoint を保存してから ready を報告する。保存できない間は復旧中とする。replay はプロセス内のメモリだけに保持し、未保存の event をログから補完しない。client は再 bootstrap し、旧 Resume cursor・未確認操作を破棄、新 Snapshot で全置換する。Presenter の入力同期と明示 Resume 後に進行する。

発表終了は新たな進行を止め、先行保存と直列化した最終 checkpoint を completion に含める。Control Plane が最終保存・Session の `Ended` 化・assignment 解放を一体で適用してから終了完了を公開する。失敗・応答消失時は終了要求中として同じ要求を冪等に retry する。確定前にプロセスを失えば未終了として復旧し得るが、未確定の終了を完了と通知しない。Host の graceful shutdown は新規受付を止めて保存・停止を試み、既存の10秒を停止期限の上限とする。

State frameはlatest-winsでreplayしない。keyframeは全visible latest-wins elementと全visible Anchor binding、deltaは前回送信後に変わったentryだけを持つ。frame sequenceは正に単調増加し、delta gap、fence不一致、`base_reliable_sequence`がControl適用cursorより新しい場合はframeを捨て、次のkeyframeを要求する。Timeline、Surface crossfade、Media、Model clipの毎frame補間値を送らない。

現行transportはRunning中、Anchorの有無によらず50 ms周期でkeyframeを送る。ControlとStateは独立streamであり、先着して破棄されたStateも後続keyframeで収束させる。接続ごとに原則20 fpsのfull keyframeを送る負荷を伴う。

Node keyframe patchは全visible Nodeについて、Timelineが現在所有しないactive、visible、opacity、およびtransformのposition・rotation・scale各componentを全て持つ。delta patchは所有されていないfield/componentの変更分だけを持つ。`NodeStatePatch.transform`ではcomponentごとの省略を許すが、空のtransform patchはrejectする。DefinitionとSnapshotのtransformは全component必須のままとする。empty patch、同じframeのduplicate element ID、profile外Node、Timeline所有propertyを含むpatchをrejectする。State mailboxはelement/field単位でlatest-wins mergeし、送信中のimmutable frameを書き換えない。

Tracking は Presenter の State stream だけが送れる。frame sequence は正に単調増加、sample target は duplicate-free、最大4件で、finite で canonical な `presentation_from_quest_local` rigid Pose を必須とする。Runtime は同じ frame の calibration で Quest-local Pose を Presentation Space へ変換する。capture timestamp は診断専用で、受理時の Runtime monotonic 時刻を freshness authority とする。

Pose を手追従などの連続演出専用の latest-wins 入力とし、Runtime で motion / Zone を再認識しない。Presenter client が Gesture の8種類と Zone の出入りを認識して Reliable Control へ送る。Gesture は種類だけを送り、距離・速度・時間窓・終了判定は client 内部の調整値とする。Zone は Presentation Space の軸に平行な一辺2mの箱、設定値は中心位置だけとし、配布された ID / 位置と Body tracking の腰位置で判定する。腰が取得できなければ停止し、別部位へ代替しない。2m は実機検証済み値ではない。server は境界の揺れや滞在時間を再計測しない。

新しい入力期間では Gesture の新しい動作を待ち、Zone の現在位置を無通知で seed する。追跡喪失を exit とせず、復帰時も無通知で seed する。Zone 内で開始した場合は外へ出て改めて入るまで enter を発生させない。認識器の内部状態や raw Pose 履歴は保存しない。

Anchor patch は visible な Anchor-bound Node ID を key に `unavailable` / `sample` / `frozen` の exactly one を持ち、follow する position / rotation だけを運ぶ。running 中は500 msを超えた sample、cut / origin / assignment 不一致を unavailable とし、描画・hit-testを停止する。別 Anchor や Stage へ fallback しない。

pause 時に有効な Anchor を共有の凍結表示状態へ確定し、Snapshot / checkpoint に含める。pause 中は Pose の経年だけで非表示にせず、pause 前から unavailable の対象に架空の位置を与えない。resume 後は最新の有効 Pose から追従し、まだ有効 Pose がなければ凍結位置を維持して取得後に再開する。この再開待ちを通常 running の500 ms freshness 規則と区別する。HMD の視点更新と操作 UI は継続する。

## 7. Runtime state とAction transaction

Runtime Core は認証済みの成立イベントに対する入力検証、Guard、Cue 選択、Action、Run allocator、completion、Step 遷移を確定する。Gesture / Zone 認識は Presenter client が担う。独立イベントは別 ID で受理順に評価し、同時成立 batch を作らない。同じ Step で有効ならそれぞれ実行し、先行イベントで Step が変われば後続の旧入力を拒否する。一イベントの Cue 候補は優先順位・order・ID 順で一つ選ぶ。server cooldown は廃止し、client の一動作一通知と動作終了判定を使う。固定待ち時間や不採用動作の新 ID による再発行は設けない。Cue は通常 `oncePerStepEntry`、必要時だけ `repeatable` とする。一つのexternal inputまたはdue-event drainはArchitecture §12.9の順序に従い、1,024回目までのmicrostepを確定できる。1,025回目は評価・適用せず、それ以前の確定済みmutationを維持して`paused/microstepLimitExceeded`へ一つのatomic mutationで遷移する。

Action batchは全Actionと`next`をpre-event snapshotに対して解決し、property claimを作ってから一度だけcommitする。`surface.setState`は対象Surfaceのstate/transitionとMedia lifecycle/playbackをclaimするため、同一Surfaceへの`media.play`/`pause`/`seek`とは両方のAction配列順で競合し、異なるSurfaceなら競合しない。同一claim、active Runとの競合、型不一致、存在しないlive target、同じStateへのcrossfade、active transitionへのsetState、crossfade中のmodel clip要求が一つでもあれば全体をrejectする。Action配列順、last-write-wins、queue、interrupt、replaceで解決しない。通常進行の外部保存失敗はこのメモリ上の commit を取り消さない。状態不変条件や容量の違反は候補を公開せず、対応する停止・拒否規則を適用する。

Published artifact上存在すべきtargetや型がRuntimeで欠落する場合は入力rejectではなくinvariant faultである。RuntimeStatusChangedを確定し、以後Presenterの明示resumeと再検証まで新規inputを受理しない。

### 7.1 Progression とresource lifetime

Presentation開始時にpresentation-owned stateを一度初期化し、initial Groupへentryする。最初に接続するclientは完成後のConnection Snapshotを受け、初期化event列のreplayを必要としない。Group entryでepochを増やし、group-owned Node、Surface、Variable、Media、Model clipをDefinition初期値へresetし、initial Step entryでstep epochを増やす。inactive GroupのstateをSnapshotに残さない。

Group exitはInteraction無効化、group-owned non-blocking Runのcancel、Node deactivate、group-owned state破棄、GroupExitedの順。presentation-owned stateとRunは維持する。Step exitではStepExecutionを破棄するが、Runはowner規則に従う。

blocking Run中はphaseをtransitioningにし、通常inputを評価しない。期限に達したTimerはfiredにするがCueを評価・再試行しない。Run completionはstateとblocking setだけを更新し、completion Triggerから新Cueを開始しない。最後のblocking Run後にpending nextを一度適用する。

Step 選択は、Session 内で到達済みの `(groupId, stepId)` ごとに保存した直近の入場開始状態1件を復元する。初期化完了後、最初の入力・時間経過を評価する前の表示、変数、Surface / Media / Model、進行中の Run を保存し、履歴も checkpoint 対象にする。未到達 Step は選択できない。現在の演出を取り消し、対象開始状態を一つの状態変更として復元して paused にし、明示 resume まで進めない。前 Step から続く演出も保存時の再生位置へ戻す。

復元では Step 入場世代・入力世代を更新し、Cue 消費を初期化、Timer を新しい入場時刻基準で再設定する。Run は新 ID と必要な owner epoch を持ち、保存位置を現在の server 時計へ rebase する。Run 参照・完了予約も一括再構築し、取消済み Run の完了通知を無効化する。Session 時計、配信連番、Run 採番、重複排除記録、認証、実空間の校正は巻き戻さない。過去の手位置を復元せず選択時点の Anchor を凍結する。開始状態履歴は実行中の inactive Group state と分け、Viewer へ履歴全体を配布しない。

### 7.2 Surface transition

CutはRunを作らずStateをatomicに変更する。同じStateへのcutはeventなしの成功no-op。Crossfadeは正のdurationを持つblocking Runで、受理時点でcanonical Stateを遷移先へ変更する。active transition中の追加setStateと同じStateへのcrossfadeをrejectする。

`u = clamp((runtimeTime - startedAt) / duration, 0, 1)`とし、旧weightは`1-easing(u)`、新weightは`easing(u)`。deadlineは`startedAt + duration`でchecked additionする。完了時にRunとtransition IDを除去してInteractionを有効化する。Renderer acknowledgementをcompletion sourceにしない。

### 7.3 Timeline

Timeline local timeは`t = clamp(runtimeTime - startedAt, 0, duration)`。easing、Vector、Quaternion補間は[Architecture §12.8](./ARCHITECTURE.md#128-timeline)の式をexactに用いる。completionでは全track終値をNode stateへ一transactionでcommitしてRunを除去する。explicit stopとGroup exitは停止時`t`の値をcommitする。Presentation endは値をcommitせずcancelする。inactive stopはeventなしの成功no-opである。

### 7.4 Video media

MediaのloopはSurface Stateごとのeffective Video content `loop`が正本であり、同じStateにboundされた全Video artifact variantの`loop`を一致させる。異なるState間では異なってよい。Media対象SurfaceはVideo content nodeをちょうど一つ持つ。対応する全StateとvariantのVideo artifactは同じ正の`durationMilliseconds`を持ち、そのadmitted値を再生時間の正本とする。State変更時はactive Media Runを現在位置でexplicit stopし、停止位置を保持してから新Stateを適用する。

Media playbackのraw位置はplaying時に`raw = positionAtReference + (runtimeTime-referenceRuntimeTime)`、paused時に固定positionとする。loopなら`position = raw mod duration`、non-loopなら`position = clamp(raw, 0, duration)`とする。Global pauseはlogical clock停止だけで表す。play中へのplay、paused中へのpauseは成功no-op、停止状態へのpauseはbatch rejectとする。停止状態へのplayは`MediaStoppedState.held_position_ms`から新しいRunとして開始する。`media.seek.positionSeconds`はActionValue解決後にfiniteかつnon-negativeを検査し、`position_ms = positionSeconds * 1000`をbinary64のまま求める。`0..duration`だけを受理し、playingなら同じruntime timeへrebase、pausedなら固定位置を置換する。停止状態へのseekはRunを作らず、`MediaStoppedState.held_position_ms`をseek位置へ置換する。この変更は`MediaStoppedSeeked(surface_id, held_position_ms)`で通知し、clientも同じ停止位置を適用する。active Runへのseekは完全なRunを持つ`MediaSeeked`で通知する。explicit stopは現在位置を`MediaStopped.held_position_ms`と`MediaStoppedState.held_position_ms`へ保存する。自然完了は`MediaCompleted.held_position_ms = duration`を通知し、同じevent適用で`MediaStoppedState.held_position_ms = 0`へresetするため、seekを挟まない再playは位置`0`から始まる。

loop動画は`position mod duration`で継続し自然完了しない。Group exitはRunをcancelしてgroup stateを破棄する。Presentation endでは値をcommitせずcancelする。音声trackは同じposition、pause、seek、loopに従う。

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

| Status                | reason                            | 条件                                                                                |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`    | `handshake_order_invalid`         | handshake順、空payload、重複handshake                                               |
| `INVALID_ARGUMENT`    | `message_invalid`                 | required presence、enum、range、参照不能                                            |
| `INVALID_ARGUMENT`    | `idempotency_key_reused`          | keyを別fingerprintで再利用                                                          |
| `UNAUTHENTICATED`     | `authentication_required`         | 認証なし・期限切れ                                                                  |
| `UNAUTHENTICATED`     | `state_nonce_invalid`             | nonce不正、期限切れ、再利用                                                         |
| `PERMISSION_DENIED`   | `presenter_required`              | Viewerがcommand/tracking送信                                                        |
| `PERMISSION_DENIED`   | `assignment_fence_mismatch`       | 接続のassignment fence不一致                                                        |
| `ALREADY_EXISTS`      | `participant_already_connected`   | 同一参加者の接続が既に有効                                                          |
| `FAILED_PRECONDITION` | `protocol_incompatible`           | version/capability不一致                                                            |
| `FAILED_PRECONDITION` | `publication_fence_mismatch`      | Publication不一致                                                                   |
| `FAILED_PRECONDITION` | `assignment_lease_expired`        | assignment lease期限切れ                                                            |
| `FAILED_PRECONDITION` | `assignment_inactive`             | assignmentが有効でない                                                              |
| `FAILED_PRECONDITION` | `presentation_origin_mismatch`    | input origin不一致                                                                  |
| `FAILED_PRECONDITION` | `state_ready_fence_mismatch`      | StateReady cut不一致                                                                |
| `FAILED_PRECONDITION` | `runtime_snapshot_required`       | private fault後、古いControl/Stateを終了しfresh paused Snapshotを取得する必要がある |
| `FAILED_PRECONDITION` | `runtime_snapshot_invalid`        | canonical projectionまたは接続cutの不変条件違反                                     |
| `FAILED_PRECONDITION` | `asset_residency_lost`            | active asset residency喪失                                                          |
| `RESOURCE_EXHAUSTED`  | `reliable_subscriber_slow`        | reliable送信queue上限                                                               |
| `RESOURCE_EXHAUSTED`  | `snapshot_catch_up_exhausted`     | Snapshot再試行上限                                                                  |
| `RESOURCE_EXHAUSTED`  | `message_limit_exceeded`          | item byte上限                                                                       |
| `RESOURCE_EXHAUSTED`  | `state_rate_exceeded`             | 継続的State rate超過                                                                |
| `UNAVAILABLE`         | `runtime_assignment_unavailable`  | assignment authorizerの検証失敗（既知のinactive・lease・fence違反を除く）           |
| `UNAVAILABLE`         | `runtime_persistence_unavailable` | checkpoint/presence callbackへ到達不能                                              |
| `UNAVAILABLE`         | `runtime_projection_unavailable`  | Control Planeのprojection取得不可                                                   |
| `INTERNAL`            | `internal_error`                  | nonceまたはconnection ID生成失敗                                                    |

status codeは標準`grpc-status`で返す。reasonはtrailing metadata key `unframe-reason`の単一ASCII lower-snake valueとして表の値を返す。同じresponseにこのkeyを複数付与してはならない。`grpc-message`は診断専用で、その本文の解析をcontractにしない。`CommandRejected`は回復可能な入力結果だけに使い、認証、role、fence、protocol、idempotency違反を丸めない。

## 9. 完了条件

実装はProto descriptor compileに加え、JSON/Proto parity、deterministic binary fixture、全enum/oneof fail-closed、Delivery closureとbudget境界、replay gap、Snapshot cut、idempotency、Action transaction、Surface/Timeline/Video/Model clipの状態遷移、pause/recovery、State frame gapを同じfixtureで検証する。生成Go/C# client接続とUnity実機budget計測は別作業だが、ここで定義したfieldや挙動をconsumer判断で変更しない。
