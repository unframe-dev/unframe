# Unframe 発表リハーサル

本番の表現を試すUnityローカルプレビューです。24場面を25イベントで進めます。自己紹介・技術紹介・写真は仮の文章や枠、3Dモデルは色違いの立方体と球です。外部モデル・写真素材、認証やルーム通信は使用しません。

## 操作

`Unframe > UI > Open Presentation UI Preview` で開き、Presenterから `Unframe rehearsal` を選び、マーカー校正後に開始します。Next/Aで通常進行し、Xで最初に戻します。モーションは使用する手のトリガーを保持し、動作後に離します。両手の動作ではどちらか一方以上のトリガーを保持します。

| 場面   | 表現・操作                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------- |
| 1〜5   | 同じ16:9パネルを保持し、テキストだけ切替                                                            |
| 6〜7   | テキストのみ                                                                                        |
| 8      | 横方向を囲む6枚のパネル                                                                             |
| 9      | 空白。発表者が移動してから次へ                                                                      |
| 10     | 振り下ろしでタイトルと5個の仮モデルが降下                                                           |
| 11     | タイトルを消し、モデルのみ残す                                                                      |
| 12     | Next/Aで「注意誘導」を表示。指差し後、もう1回Next/Aで固定のモデルを中央へ、他を周辺へ移して薄く表示 |
| 13     | 空白                                                                                                |
| 14     | 振り下ろしで対象が現れる                                                                            |
| 15     | 右へ横振りで切替                                                                                    |
| 16     | 両手を広げてモデルを拡大                                                                            |
| 17     | 「面白いと思えるものだった」                                                                        |
| 18     | 理由をまとめる文章                                                                                  |
| 19     | 仮の技術紹介                                                                                        |
| 20〜24 | パネルなし。文字が手前から中心へ移動。次の進行で中心へ抜けながらフェード                            |

12は2段階のため、場面番号とイベント番号は途中から異なります。モーションイベントは10・15・16・17です。モーション場面もNext/Aで手動スキップできます。指差し認識やモデル選択は行わず、注目対象は事前に固定します。モデルの散らばり方も毎回同じです。

## 表示とデータ

全体の配置・大きさを共通ルートのscale 0.5で縮小し、中心の高さを0.35m（従来より0.4m下）にしています。要素の奥行きは中心〜手前の範囲に収め、10のタイトルはモデルの間の中央に配置しています。基本パネルは縮小後1.7m × 0.95625mの16:9です。見出し・本文は別テキストとして配置し、文字サイズと行間を分けています。必要な場面は左揃えにし、原案の言葉を主体にしています。ローカル描画では透明パネルによる文字の隠れを防ぐため、文字をパネルより後に描画します。文字は既存NativeUiの領域指定を使い、折り返しと一様縮小で余白内へ収めます。診断UIは標準で非表示で、`QuestArmMotionDebugView` の `Diagnostic Visible` を有効にすると再表示できます。

正本は `Assets/Resources/MotionPresentation/MotionPresentationDefinition.json`。共有v2 Cue/Timelineを既存Coreで実行して、`Tools/generate-motion-presentation.ts` がDelivery/Snapshot/Controlとモーション対応表を再生成します。旧生成Controlと対応.metaは再生成時に削除します。新しいControlの.metaはUnityでインポートして保存します。

```bash
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts --check
pnpm --filter @unframe/contracts exec tsx --test ../../app/unity/Tools/motion-presentation.test.ts
```

変更後は `Unframe > UI > Open Presentation UI Preview` を実行して保存シーンへ割り当てます。APKは `Unframe > UI > Build Presentation UI Preview APK` で更新します。共有Definitionの構成を使用しますが、本番RenderBundleの作成やRealtimeへの接続を代替するものではありません。トリガー保持操作はUnityローカルのみです。

## 検証

2026-10-09にUnity EditModeテスト585件と生成・Cue進行・JSON往復等のTypeScriptテスト6件が成功しました。型・フォーマット・meta整合性も確認済みです。代表場面のEditor描画で文字とパネル、モデル配置を確認しました。`nix run .#check` は既存CLIの保存・キャッシュ関連23件の失敗で停止しました。APK更新とQuest実機での読みやすさ・動作確認は未実施です。
