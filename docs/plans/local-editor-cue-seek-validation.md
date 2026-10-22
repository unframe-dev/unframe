# Cue 単位シークの初期検証

2026-10-22。対象は [UI 再構成計画](local-editor-preview-ui-refactor.md) のシーク成立性。基点 `a5f57c0`、ブランチ `refactor/local-editor-ui-ux`。Local Editor、Core、CLI、Unity の製品コードと既存テストは変更していない。

## 判定

**検証した Cue 内の前後シークは、既存 wire を使って Unity の状態・補間値へ適用できた。統合シーク機能は未実装。**

Core → CLI の実実装が生成した JSON を Unity の Protobuf parser と Preview transaction へ渡し、Timeline 2本と Surface crossfade の同時適用、一時停止、終端からの巻き戻しを確認した。この範囲では wire 拡張は不要。Unity Editor の EditMode（`-nographics`）での状態・material parameter の検証であり、WebGL／Quest の最終描画ピクセルは未確認。

実発火記録、確認 session、CLI の seek command は未実装。以下の成功は既存機能・分離した probe の検査結果であり、シーク機能の完成を示さない。

## 実行結果

Nix 環境内で、対象ファイルに限定して実行した。

| 対象            | コマンド（`nix develop --command` に続ける）                                                                                                                                                    | 結果     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Core            | `pnpm --filter @unframe/unframe-core test test/cue-executor.test.ts`                                                                                                                            | 9件成功  |
| CLI             | `pnpm --filter @unframe/unframe-cli test test/local-playback.test.ts test/local-preview.test.ts test/author-http.test.ts`                                                                       | 39件成功 |
| Preview adapter | `pnpm --filter @unframe/local-editor test src/features/editor/model/preview-playback.test.ts src/features/editor/model/preview-session.test.ts src/features/editor/infra/unity-preview.test.ts` | 13件成功 |
| TypeScript      | CLI／Core の `typecheck`、Local Editor の `check`                                                                                                                                               | 全て成功 |

前回実行した TypeScript の既存テストは計61件。Preview adapter は Unity bridge を置き換えた試験であり、実 Unity の描画試験ではない。依存準備は `nix develop --command pnpm install --frozen-lockfile`、lockfile の変更なし。

### Core と wire の隔離 probe

実行コードと結果はローカルの `.unframe/validation/cue-seek/ts/` に保存した。製品コードから呼び出す経路はない。

```bash
nix develop --command node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs .unframe/validation/cue-seek/ts/probe.ts
```

`executeCueEvent`、`advanceCueClock`、`projectPlaybackWire`、`previewPlaybackCommandSchema` の実実装を使用し、次を確認した。

| 検証                           | 実測と意味                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実発火後の checkpoint          | 遷移先が `stay` の Cue で、Timeline 2本と Surface 遷移1本、共通の発火時刻・cause を保持できる                                                                                      |
| checkpoint の clone から再評価 | `0 / 500 / 1000 / 500 / 0ms` をそれぞれ同じ checkpoint から評価できる。終端1000msでは通常 Core が Run を完了し、phase は stable、opacity の終値は0.5／0.25                         |
| 通常 Core 時計の巻き戻し       | 500msの state を直接0msに進める要求は RangeError。時計を巻き戻す API としては使えない                                                                                              |
| 確認専用の wire 表現           | Core の進行関数を呼ばず checkpoint の描画時計だけを指定した場合、同じ3 Run を終端でも保持し、pause と増加する sequence で各時刻を表現できる。Unity への適用は下記の別 probe で確認 |
| Group exit                     | 戻り値には旧 Group の変数・active runs が残らず、取消情報だけが返る。actions 適用後・遷移前の checkpoint は結果から取得できない                                                    |
| CLI の新規 command             | `seekCue` は schema で拒否される。既存 command は `poll / play / pause / reset / input` のみ                                                                                       |

通常 Core 再評価の sequence は1〜5、確認用投影は6〜10。offset を戻しても配送 sequence を戻さない。Core の通常進行を確認モードにそのまま使うと、終端処理や後続進行が走るため、計画どおり分離が必要。

### Unity の実行結果

Unity 6000.3.22f1（`/home/t4ko/Unity/Hub/Editor/6000.3.22f1/Editor/Unity`）で既存 playback 試験10件、隔離した追加 probe 5件が全て成功。失敗・skip は0件。

```bash
nix develop --command env TMP=/tmp TMPDIR=/tmp bash scripts/unity/test-native-editor.sh playback
nix develop --command env TMP=/tmp TMPDIR=/tmp bash .unframe/validation/cue-seek/unity/run.sh
```

インストール前は実行ファイル不在で起動できなかった。インストール後の初回起動も、テスト開始前に `Failed to create CoreCLR, HRESULT: 0x8007000E` と Nix の一時ディレクトリ配下の作成失敗を出して停止した。停止中の当該プロセスを終了し、プロセス限定で `TMP`／`TMPDIR` を上記のとおり指定した再実行は成功した。初回停止の原因や、どちらの変数が影響したかは確定していない。

追加 probe は次を確認した。

| 検証                     | 結果                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 終端からの巻き戻しと復帰 | 同じ Timeline／Run ID で offset `0 → 500 → 1000 → 500 → 0ms` を適用。node X は `0 → 1 → 2 → 1 → 0`、opacity は `1 → 0.5 → 0 → 0.5 → 1`。pause 中の後続更新でも値を保持し、Run を除いた canonical state へ復帰できる                                         |
| 複数 Run と crossfade    | Timeline 2本と Surface 遷移を同一時計で適用。material の `_Blend` も `0 → 0.5 → 1 → 0.5 → 0` へ戻る                                                                                                                                                         |
| Run の再登録と配送順序   | 終了して除去された Run を同じ ID・新しい sequence で過去時刻へ再登録でき、古い sequence は拒否される                                                                                                                                                        |
| 適用途中の例外           | Surface の `MeshRenderer` を意図的に破棄すると `MissingReferenceException` が発生するが、node X と sequence は更新済み。同一 sequence の再試行は stale、新しい sequence でも同じ故障が続く。別 request の prepare／commit による scene 再構築後は適用できる |
| 実 Core／CLI wire の受信 | canonical schema で検証した定義から Cue を実発火し、`projectPlaybackWire` が生成した JSON 5件を Unity の実 parser／transaction で受信。3 Run、増加する sequence、一時停止、前後移動時の pose／opacity／crossfade を確認                                     |

実 wire 用データの生成コマンドは次のとおり。

```bash
nix develop --command node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs .unframe/validation/cue-seek/ts/emit-unity-wire.ts
```

既存試験の結果は `.unframe/local-editor-e2e/logs/playback.xml`／`playback.log`、追加 probe は `.unframe/validation/cue-seek/unity/` の `CueSeekValidationTests.cs`、`results.xml`、`editor.log`、`core-playback.json`、`wire-generation.log` に保存した。

## 残る確認と計画への影響

- 検証した正常系では既存 wire を利用できる。通常 Core の時計と確認用の描画時計・配送 sequence を分離する方針を維持する。
- 故障注入試験の成功は、既存の部分適用と復旧上の課題を再現できたという意味であり、rollback の成功ではない。適用中の例外に対する正常 state 復元、Host との再同期、復元不能時の表示 receipt 無効化は今後の設計・実装・検証が必要。
- 実発火境界の capture、occurrence の保持と失効、確認 session、要求集約、通常再生の退避・復帰、Dev／Dist の definition 照合は今後の実装対象。
- Local Editor UI の操作経由の E2E、HTTP／bridge を通す統合シーク、実 WebGL／Quest の描画確認は未実施。JSON の受信と Unity 内の適用確認は、未実装の統合機能の代わりにはならない。

`.unframe/validation/cue-seek/` の probe・ログと `.unframe/native-editor-playback/project/` の生成 Unity プロジェクトは Git 管理外のローカル検証資料。この文書だけから追加 probe を再実行することはできない。リポジトリ全体のテスト／build、UI 実装、製品コードの修正、commit／push は行っていない。
