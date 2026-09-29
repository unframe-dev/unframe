# v2 contract fixtures

JSON は ModelNode、一つずつの baked-web / native-ui / video Surface、数値 Variable、モデル clip 再生 Cue を持つ合成公開物です。Definition → Bundle → Build → Publication の canonical hash と Asset descriptor の一致をテストします。

素材 checksum、モデル件数、Capability の値は構造検証用の合成値です。実バイトは付属せず、素材検査・GPU admission・動画再生の成功例ではありません。製品の端末 profile として使用しないでください。

`wire/` は停止した二 clip の保持姿勢、一時停止した crossfade、明示 null、clip を持たないモデルの配信 Node の独立した Protobuf encoding 例です。Run reducer や参照先素材は含まず、serialize / deserialize で各状態を失わないことを検証します。
