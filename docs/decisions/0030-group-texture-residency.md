# ADR-0030: Group ごとの Texture 常駐と先読み

## Status

Accepted

## Context

全 State の画像を開始前に GPU 常駐させる方式では、同時表示しない場面も予算を消費する。今回のデモは PNG とモデル内の Texture を合わせ約144 MiBあり、既存の64 MiB上限を超えた。

## Decision

- Unity Media と Audience Web の Texture GPU 予算と encoded cache 予算を64から192 MiBへ引き上げる。Audience の常駐 binding 上限は8から32とする。単一素材の serial load CPU 予算、画像サイズ、shader の同時 sampler 上限は変えない。
- PNG の常駐窓を、presentation 所有の全 State、現在 Group 所有の全 State、現在 Group の Cue が直接遷移できる全 Group 所有の全 State の和とする。guard は先読み候補を減らす根拠にしない。循環は一段先までで打ち切る。
- Delivery は全画像のカタログと Group ごとの窓を渡す。`totalDecodedGpuBytes` はカタログ全体の和を維持し、窓の最大 GPU bytes と binding 数を別 field に記録する。admission は窓の最大値に、全常駐させるモデル内 Texture の費用を足して判定する。checksum が同じ画像は一度だけ計上する。
- Local Editor の Unity Preview は全 PNG を事前に常駐させ、Group ごとの解放とメモリ予算上限の admission を適用しない。素材の整合性検証と画像サイズ・描画機能の制約は維持する。
- 本番配信のクライアントは現在 Group の窓を準備し、描画参照を外した窓外の GPU Texture を解放する。opacity 0 だけでは解放しない。Group 内の再表示、Surface crossfade、非表示から始まる Timeline は全 State 常駐で保護する。
- 戻る操作・途中参加・高速進行で窓の準備が間に合わない場合は、準備後に最新の canonical state へ描画を合わせる。canonical clock や操作結果は変更しない。旧表示と候補の同時保持が予算を超える場合は、旧表示を外してから読み込む。Unity の遅延 Destroy が完了する前に追加 upload しない。
- GPU 常駐と encoded cache の寿命を分ける。Web は予算内の encoded LRU、Unity は既存の検証済みファイルキャッシュを使い、GPU から退避した画像も再利用できるようにする。本番配信では encoded データ全体の配信・キャッシュ予算検査を維持する。
- Delivery 4、Projection 3、Local Preview 2へ更新し、旧版との暗黙の互換経路は設けない。ADR-0012 の解像度・RGBA32・byte式・Compiler予算は維持し、本番配信での全画像の事前 GPU 常駐とセッション終了までの pin 方針を本 ADR で置き換える。

## Consequences

場面ごとの素材は `owner: group`、閉幕まで使うロゴなどは `owner: presentation` にする必要がある。全素材を presentation 所有にした作例は、引き続き全画像を常駐させる。分岐先が多い Group は先読み集合も大きくなる。

未常駐の場面への移動では描画を保留し得る。全画像を常駐させる方式の「すべての切り替えで追加 upload が不要」という保証は維持しない。予算の引き上げは端末の実測保証ではなく、Quest と対象スマートフォンでのメモリ・起動時間・フレーム時間の確認が必要である。

## Adoption and Exceptions

分岐・循環・共有 checksum・空 Group の窓計算、モデル費用の加算、窓外解放、共有画像の保持、戻る際の再ロード、非同期準備の取消・失敗、予算超過時の解放順序をテストする。descriptor 不一致や不正な窓は拒否する。予算や窓方針を変更するときは、契約・全 consumer・検証を同じ変更で更新する。
