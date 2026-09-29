# React State capture の受け入れ範囲

[PR #111](https://github.com/unframe-dev/unframe/pull/111) の `6db583e` を起点とする追加実装。Editor の A3 は別作業であり、本変更に Source patch・保存 host・Inspector を含めない。A4 の共有値編集、Editor preview の操作経路、publish / Delivery / Go・C#・Unity consumer の接続も、この変更の完了条件から分けて扱う。

## 公開契約

- `defineComponent` は `interactions` / `initialState` / `states` / `actions` / `outputs` を一組で受け取る。省略時は従来の静的 default State。`render.state` は Component 内の State key で、Instance ごとの canonical State ID は Compiler が生成する。
- button は宣言された Interaction に結び付ける。React の event handler を Runtime の遷移元にせず、既存の Output → Cue → Action → State を使用する。viewer の入力権限は変更しない。
- `texts` と `bindings` は全基底 key を保持する。State で除外された Node の binding を DOM に残すと capture は失敗する。無効な button は意味に残るが Hit Region を出力しない。
- Structured と React を混在させる場合は、既存の `scene: { spatial, components }` の `components` に React Instance を含める。React 専用の scene 配列も使用できる。異なるモードの Component 間を横断する Cue は明示的に拒否する。

## 描画境界

Opaque は Surface 全体を一つの描画単位とする。binding geometry と画像を同一の安定した layout から取得し、操作領域を Surface の logical 座標に正規化する。texture や paint bounds では操作領域を切り取らない。viewport・overflow clip を適用し、非対応の回転・skew・perspective・clip-path 等は拒否する。

CSS の `@font-face` は固定入力の TTF / OTF を参照する。実際に描画した font を検査し、OS fallback、未宣言の weight / style、glyph 欠落を拒否する。作者は heading や button の既定スタイルも含めて font を指定する。疑似要素の文字描画は現在の対応範囲に含めず拒否する。未指定の背景は透明とする。

全描画計画の件数・画素・capture 予算と、Opaque の出力・安定判定 buffer を描画前に検査する。出力時の実 bytes 上限と worker の cgroup 制限も維持する。close は進行中 worker の終了を待ち、一時ファイルを回収する。

## 検証経路

- Authoring / Compiler の型・拒否テストは通常の Presentation package CI で実行する。
- `nix develop --command scripts/ci/opaque-capture.sh` は隔離・State / geometry・font・worker 回収と CLI 実 build を実行する。
- CLI fixture は Structured と有限 State React を同じ Presentation に置き、check → build → Core の意味検証・build integrity を確認する。配布先に TS / JS / CSS を含めず、配置だけの変更で PNG が変わらないことも確認する。
- 同一入力の反復 build と、capture 失敗時に成功済み dist が残ることは実 Browser fixture で検証する。stale revision の拒否は CLI の revision テストで検証する。

Editor の保存 transaction・recovery、編集から preview までの時間、publish 受け入れ検証の合成、Delivery の partition version と consumer の相互運用は、上記テストの成功から推定しない。

2026-09-29 の Linux / Nix ローカル検証では、`nix run .#check` が成功した。隔離 Browser の 32 テストは約 185 秒、CLI の反復・混在 build の 2 テストは約 403 秒で完了した。これらは fixture 準備を含むテスト全体の時間であり、cold / warm build の区間時間や Editor の応答時間とは区別する。
