# ADR-0009: Semantic role と Hit Region の portable schema を定義する

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: Unframe 開発チーム
- **関連**: [Presentation Architecture](../presentation/ARCHITECTURE.md), [Presentation Design](../presentation/DESIGN.md), [Contracts Architecture](../../packages/contracts/ARCHITECTURE.md), [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)

## Context

現行 `SemanticNode` は `role` とすべての optional field を一つのflat objectに持つため、heading level、button label / interaction、image alternative、list / tableのrequired owned structureを型で区別できない。`RenderBundle.semanticsByState` もDefinitionと同じschemaを再利用し、Stateごとのinteraction enabled状態を表現しない。

現行Hit Regionはnormalized rectangle、Interaction、Semantic Node、event、priorityを持つが、stable region ID、canonical order、overlap tie-breakがない。`event` はInteraction definitionと重複し、二つの正本を作る。これらを確定しないままM3 Slice Bへ進むと、TypeScript、renderer、Delivery、Unityでaccessibility treeとhit-test結果が分岐する。

本ADRはM2 item 3としてportable semantic contractを固定する。M2では設計だけをAcceptedにし、Zod / JSON Schema、Core materialization、Compiler lowering、renderer output、fixtureはM3 Slice Bで同じ変更系列として実装する。現行schemaと実装はinitial flat subsetのままであり、本ADRのtarget contractが実装済みであるとはみなさない。

## Decision

### Definition tree と Completed tree

Authoring / PresentationDefinitionが持つ状態非依存の`SemanticTreeDefinition`と、CompilerがSurface Stateごとにmaterializeする`CompletedSemanticTree`を別schemaにする。

```ts
type SemanticNodeBase = {
  id: SemanticNodeId;
  parentId: SemanticNodeId | null;
  order: number;
};

type SemanticTextFields = {
  text: string;
  language?: string;
};

type SemanticNodeDefinition =
  | (SemanticNodeBase & SemanticTextFields & { role: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 })
  | (SemanticNodeBase & SemanticTextFields & { role: "paragraph" })
  | (SemanticNodeBase & { role: "image"; alt: string; language?: string })
  | (SemanticNodeBase & SemanticTextFields & { role: "button"; interactionId: InteractionId })
  | (SemanticNodeBase & { role: "list"; ordered: boolean })
  | (SemanticNodeBase & SemanticTextFields & { role: "listItem" })
  | (SemanticNodeBase & { role: "table"; label?: string; language?: string })
  | (SemanticNodeBase & { role: "row" })
  | (SemanticNodeBase & SemanticTextFields & { role: "cell" })
  | (SemanticNodeBase & SemanticTextFields & { role: "columnHeader" })
  | (SemanticNodeBase & SemanticTextFields & { role: "rowHeader" });

type SemanticTreeDefinition = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, SemanticNodeDefinition>;
};

type CompletedSemanticNode =
  | Exclude<SemanticNodeDefinition, { role: "button" }>
  | (Extract<SemanticNodeDefinition, { role: "button" }> & { stateEnabled: boolean });

type CompletedSemanticTree = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, CompletedSemanticNode>;
};

type ProjectedSemanticNode =
  | Exclude<CompletedSemanticNode, { role: "button" }>
  | (Omit<Extract<CompletedSemanticNode, { role: "button" }>, "stateEnabled" | "interactionId"> &
      ({ enabled: true; interactionId: InteractionId } | { enabled: false }));

type ProjectedSemanticTree = {
  rootNodeIds: SemanticNodeId[];
  nodes: Record<SemanticNodeId, ProjectedSemanticNode>;
};
```

各variantは上記fieldだけを持つstrict objectとする。`order` はnon-negative integerで、同じparentのsibling間で一意とする。Node record keyと`node.id`は一致し、ID、text、alt、label、languageはUnicode scalar valueだけを含みlone surrogateを拒否する。

`language` はwell-formed BCP 47 language tagとし、空文字列を拒否する。tagのcasingは意味比較に使用せず、source spellingをportable artifactへ保持する。省略時は最も近いancestorのlanguage、なければbuild context localeを継承する。

heading、paragraph、button、listItem、cell、columnHeader、rowHeaderのaccessible textはnon-empty `text`を必須とする。Native UIのdynamic textを同じNodeへbindingする場合、この`text`はempty / unavailable時のcanonical accessibility fallbackであり、通常時のeffective semantic textはvisual textと同じformatted valueに置き換える。独立したsemantic binding fieldは作らず、delivery profileが選択した`NativeUIArtifact`内でそのNodeを参照する唯一の`NativeUINode` textをbindingの正本とする。CompilerとControl Planeはartifact内およびprofile横断で参照が一意であることを検証する。dynamic formatterの結果がemptyならclientはvisual textをemptyのまま扱い、effective semantic textだけをDefinitionのnon-empty fallbackへ戻す。

imageはnon-empty `alt`を必須とする。装飾専用imageはSemantic Treeへ含めない。buttonはnon-empty `text`と`interactionId`を必須とし、他roleは`interactionId`を持てない。tableの`label`はoptionalだが、存在する場合はnon-emptyとする。

### Tree structure

v1のrequired parent / child relationを次に固定する。

| role                                 | allowed parent | allowed direct children                           |
| ------------------------------------ | -------------- | ------------------------------------------------- |
| heading / paragraph / image / button | root only      | none                                              |
| list                                 | root only      | one or more `listItem`                            |
| listItem                             | `list`         | none                                              |
| table                                | root only      | one or more `row`                                 |
| row                                  | `table`        | one or more `cell` / `columnHeader` / `rowHeader` |
| cell / columnHeader / rowHeader      | `row`          | none                                              |

空Treeは許可する。空でないTreeは全Nodeが一つのrootから到達でき、parent cycleを持たず、`parentId === null`のNodeだけを`rootNodeIds`へ一度ずつ含める。rootとsiblingのcanonical orderは`order`昇順とし、同値はinvalidである。nested list、row group、rich cell content、interactive table / gridはv1に含めず、必要になった時点でroleとschema versionを追加する。

WAI-ARIAのrequired owned / context relationをportable subsetの根拠にするが、Semantic TreeをDOMまたはARIA attribute bagとして扱わない。rendererはDOMからroleやrelationを推測せず、このcontractからplatform accessibility representationを生成する。

### State materialization

`SurfaceSemanticOverride`は既存のordered layer規則を維持する。`included`は全role、`text` / `language`はSemanticTextFieldsを持つrole、`alt` / `language`はimage、`label` / `language`はtableだけに指定できる。role、level、ordered、parent、order、interactionIdはoverrideできない。

override objectはtarget Nodeのroleを自身には複製しないため、Zodはfield集合だけをstrictに検証し、Presentation Coreがtarget Nodeをlookupしてroleに禁止されたpropertyをstable diagnosticで拒否する。M3ではroleごとのvalid / invalid override fixtureでこの境界を固定する。

`included: false`はdescendantを含めて除外する。除外後もrequired structureを満たさなければならず、list / table / rowを空にするStateはbuild errorとする。requiredなtext / altの`null`削除は禁止する。optionalなtable labelは`null`で削除できる。

CompilerはStateごとにoverrideを適用し、除外Nodeを除去してroot orderを再構築した後、buttonの`stateEnabled`を`SurfaceStateDefinition.enabledInteractionIds`から導出する。authorは`stateEnabled`を直接指定しない。Completed treeだけを`RenderBundle.semanticsByState`へ格納し、override layerをDelivery / Runtimeへ送らない。

各enabled Interactionは同じStateのCompleted treeに`stateEnabled: true`のbutton Nodeを一つ以上持つ。同じInteractionを複数buttonが参照できる。disabled Interactionを参照するbuttonは`stateEnabled: false`として残せるがHit Regionを持たない。Interactionを参照するbuttonがすべてStateから除外された場合、そのInteractionをenabledにできない。

### Hit Region schema

```ts
type ResolvedInteractiveRegion = {
  interactionId: InteractionId;
  semanticNodeId: SemanticNodeId;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  coordinateSpace: "normalized";
  priority: UInt32;
};
```

`UInt32`はwire上の`0..4_294_967_295`のintegerを表すportable scalarである。Hit Regionはruntime identityを持たず、array positionもcommandやSnapshotから参照しない。現行portable contractが任意number、renderer conformanceがnon-negative integerを要求するdriftはM3でcontract側を`UInt32`へ厳格化して解消する。`event`は持たず、Runtime Coreが`interactionId`からPresentationDefinitionのcanonical eventを解決する。異なるInteractionが同じeventを共有することは許可するが、authorityとhit-test結果は常にInteraction IDで扱う。regionを持つ全Interactionのeventは`SurfaceRenderIntent.interaction.events`に含まれなければならず、rendererはintentにないeventを追加できない。

canonical Interaction definitionはrequired `hitPriority: UInt32`を持ち、Authoring `InteractionDeclaration`も同じ値を明示する。Compilerはこの値をprivate / portable regionへcopyし、renderer、Delivery、clientは変更しない。M3では現行Interaction declaration / schemaをbreakingに拡張し、暗黙defaultやsemantic orderからの推測を追加しない。

`x` / `y` / `width` / `height` は有限値で、`0 <= x < 1`、`0 <= y < 1`、`0 < width <= 1 - x`、`0 < height <= 1 - y`を満たす。target pipelineではartifact producerがADR-0011のpartition-local private regionを一度だけclipし、Compiler aggregateがSemantic Surface全体のnormalized logical coordinateへ変換する。aggregate後に面積がないregionを出力しない。portable boundsはRender Surface、texture、pixel、UVの座標を持たない。logical / UV / Unity変換とclip authorityはADR-0010、private regionのexact shapeとaggregateはADR-0011を正本とする。

一つのInteraction / button Nodeが複数regionを持つこととregion同士のoverlapを許可する。`interactionId + semanticNodeId + x + y + width + height`が同じregionはpriorityにかかわらずduplicateとしてinvalidとする。artifact producerはpartition-local private region内のduplicateを拒否し、Presentation CoreはCompiler aggregate後にRenderBundle全体のcross-partition invariantとして再検証する。canonical array orderとhit-test winnerは`priority`降順、次に`interactionId`、`semanticNodeId`のRFC 8785と同じUTF-16 code-unit昇順、最後に`x`、`y`、`width`、`height`の数値昇順とする。local input pointは`0 <= x < 1`、`0 <= y < 1`とし、rectangleはleft / top inclusive、right / bottom exclusiveで判定する。候補の先頭regionの`interactionId`を選ぶ。

各regionは同じStateのCompleted treeにある`stateEnabled: true`のbutton Nodeを参照し、そのbuttonの`interactionId`とregionの`interactionId`が一致しなければならない。enabled Interactionは一つ以上のregionを持ち、disabled / unknown Interaction、excluded / non-button Nodeはregionを持てない。State recordは到達可能な全Stateをexactly onceで含む。

Hit Regionはclient-side affordanceでありauthorization boundaryではない。Surface interaction commandはpoint、region ID、Semantic Node ID、event、renderer artifactを送らず、Runtime Coreが認証済みrole、current State、enabled Interaction、transition、Publication / Origin fenceを再検証する。priorityやregion overlapによってRuntime authorityを変えない。

### Projection と compatibility

Semantic Surfaceはhost Spatial Nodeの`ProjectionAudience`を全体として継承し、一つのSemantic Tree内にpresenter / viewer audienceを混在させない。Deliveryはprofileから不可視なSurface、Completed tree、Hit Regionをまとめて除外する。

`ProjectionProfileDescriptor.semanticSurfaces`をProjected tree / Hit Regionのdelivery carrierとする。keyはvisible Semantic Surface ID、値は全reachable Stateをexactly onceで持つ`semanticsByState: Record<SurfaceStateId, ProjectedSemanticTree>`と`interactionsByState: Record<SurfaceStateId, ResolvedInteractiveRegion[]>`である。`visibleSurfaceIds`とrecord keyは同じ集合でなければならない。RenderBundleはrole非依存のCompleted treeを保持し、Control Plane / Deliveryがprofile生成時にこのcarrierへprojectする。Delivery contract validationはviewer profileのbuttonにInteraction IDがなく、Hit Regionが空であることを検証する。

可視SurfaceではDeliveryがCompleted treeをSession roleごとの`ProjectedSemanticTree`へ変換する。button以外のrole / field / structureは変更しない。v1でShared progressionを変更できるparticipant inputはPresenterだけなので、Presenter projectionの`enabled`は`stateEnabled`と同じ値、Viewer projectionの`enabled`は常に`false`とする。Hit Regionはprojected buttonが`enabled: true`のものだけを送る。Viewerにはbuttonのlabelとroleをdisabled affordanceとして残すが、Interaction IDとHit Regionを配信しない。Projected buttonは`enabled: false`のとき`interactionId`を持たないstrict variantとし、Unity側で後からfieldを隠す処理をauthorization boundaryにしない。

Definition schemaとCompleted schemaを混同せず、unknown role、unknown required field、roleに禁止されたfield、unsupported schema versionはfail closedとする。同じversionで許可する追加は全consumerが安全に無視できるoptional metadataだけとし、role、required field、parent / child relation、hit-test規則の変更はbreaking changeとする。

現行`schemaVersion: 1`は未公開のinitial subsetであるため、M3ではflat schemaを新しいv1 shapeへ一括置換し、legacy unionやfallbackを追加しない。現行Renderer APIがnormalized `HitRegion`を直接返す一partition contractも同時にprivate region / Compiler aggregateへ置換する。fixture、generated JSON Schema、Core、Compiler、renderer、reference projectを同じcommit系列で更新する。

## Consumer responsibility

| Consumer                 | Responsibility                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Contracts                | Definition / Completed role union、override、Hit Regionのportable Zod sourceとgenerated JSON Schema                              |
| Presentation Core        | tree / role relation、State materialization、accessible value、button enabled、cross-artifact invariant                          |
| Compiler                 | authoring role lowering、stable ID、dynamic binding、State completeness、canonical order                                         |
| Renderer API / Web       | 完成Treeを変更せず、visible geometryをpartition-local private regionへ解決し、local ID / boundsを検証                            |
| Control Plane / Delivery | audience / Session role / capability closureを検証し、Projected treeを生成してprofile外Tree / interaction / regionを配信前に除外 |
| Unity / Web preview      | 同じCompleted treeからplatform semanticsを生成し、同じordered region hit-test fixtureを適用                                      |

## Consequences

- invalidなrole / property組合せと不完全なlist / tableをschema / semantic validationで拒否できる。
- Stateごとのbutton `stateEnabled`、roleごとのprojected `enabled`、Hit Region availabilityが一方向に導出される。
- Hit Regionからevent重複とarray-position identityを除き、renderer / Unityのoverlap結果を一致させられる。
- current flat contractに対するbreaking implementationはM3 Slice Bで行い、本ADR自体はcode / generated artifactを変更しない。

## Alternatives Considered

### flat nodeにoptional fieldを追加し続ける

roleに不可能なproperty組合せを構造schemaで拒否できず、consumerごとの推測を残すため採用しない。

### renderer DOMからARIA treeを抽出する

Opaque implementationとbrowser差がsemantic source of truthになり、Structured / Native UI / baked-webの意味が分岐するため採用しない。

### Hit Regionにeventを複製する

Interaction definitionとの不一致時にauthorityを選ぶ必要が生じるため採用しない。

### overlapをbuild errorにする

複雑なvisual affordanceを不必要に制限する。deterministic priority / ID順で解決できるため採用しない。

## Follow-ups

- M3 Slice Bでcontract、Core、Compiler、renderer、fixture、reference projectをTDDで実装する。
- M2 item 4でSemantic Surface logical coordinate、normalized point、UV、Unity local coordinateの完全な変換規則を固定する。
- M5でDeliveryManifest / C# generated artifactへCompleted treeとHit Regionを接続する。
- rich text、nested list、rowgroup、interactive grid、toggle button、viewer-local interactionは新しい利用要件とversioned contractを伴うfollow-upとする。
