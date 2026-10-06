# ADR-0024: Publication HTTP境界とUnityのRuntime transport

## Status

Accepted

## Context

M5の生成consumerに、Control Planeの公開処理とUnityの双方向Runtime接続を接続する。Definitionなどのv2成果物はJSON Schemaを正本に持つ一方、深いunionをHTTPのOpenAPIへ重複展開すると、C# generatorが再帰展開で失敗する。

## Decision

- Build登録のHTTP bodyは、Definition、RenderBundle、AssetSet、BuildManifestのcanonical JSON文字列を受け取る。各文字列は最大8 MiBとし、Control Planeでparse、正本schema、semantic closure、hash closure、canonical一致を検査する。OpenAPIに別の緩い成果物schemaを作らない。
- Asset bytesはBuildのdescriptorに従って個別にアップロードする。Publication確定時にR2の実bytesを再検証し、D1でexpected publication epochとactive Sessionを検査する。CLIは検証済みのlocal build generationを送り、credentialをprocess外へ保存しない。
- Deliveryは認証済みparticipantのdevice capabilityをControl Planeで固定し、生成済みProtobufで返す。UnityはDeliveryのpublication、assignment、projectionとbootstrapを照合し、再接続ごとにbootstrap credentialを更新する。assignment変更はDeliveryの再取得を要求する。
- Unityは生成済みRealtime v2 client、固定versionのGrpc.Net.Client、Unity Package Managerでcommitを固定したnative HTTP/2 handlerを使用する。managed DLL、NuGet archiveとlicenseはchecksumで再現・検査する。Venue Edgeの証明書pinは認証済みbootstrapに由来し、証明書検証の無条件無効化を許可しない。
- Baked Web v1 PNGは既存のportable encoder形式を直接decodeし、RGBA32、sRGB、mipmapなしでserial uploadする。upload後はnon-readableとし、全selected textureのresident確認後にState接続とinputを有効にする。未実装のModel、Videoを別rendererへ置き換えない。Trackingは呼び出し元が取得・校正したcanonical PoseをState streamへ送る。

## Consequences

HTTP transportのschemaは浅くなり、成果物の意味検証はCoreの公開境界へ集約できる。一方、登録時とPublication確定時の検証費用、固定native pluginとmanaged dependencyの更新作業が必要になる。UnityのPNG decoderはv1 encoder形式専用であり、一般PNG decoderとして使用しない。

この決定は実機での性能を保証しない。EditorのHTTP/2・texture検証、サービスのlocal検証、QuestでのGPU / CPU peak計測を別の証拠として扱う。M6の完了条件には実サービスのauthoritative execution、replay / resume、checkpoint / completionと実機検証も含まれ、生成consumerやmock endpointだけの成功では完了にしない。

## Alternatives Considered

- 成果物schemaをOpenAPIへ複製する: 正本と検証規則が分岐し、generatorの深い展開も解消しないため採用しない。
- Unityのmanaged HTTP handlerだけに依存する: 対象platformのHTTP/2双方向streamを検証できないため、native handlerを明示する。
- Unityの一般画像loaderへdecodeを任せる: EditorではARGB32へ変換され、v1のRGBA32とportable CPU chargeをそのまま検証できないため採用しない。

## Adoption and Exceptions

OpenAPI / Protobufの生成とdrift検査、CLIからのartifact一致、Control Planeの認証・admission・CAS、Runtimeのwire接続、Unity Editorのnetwork / residencyをそれぞれ検証する。device未接続などで実測できない項目は未完了として記録し、milestoneを完了扱いしない。
