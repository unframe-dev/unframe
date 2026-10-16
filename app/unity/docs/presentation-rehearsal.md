# Unframe 発表リハーサル

空間表現と発表のリズムを試すUnityローカルプレビューです。24場面を25イベントで進め、原案の流れを短い文章で伝えます。立体は契約のbox／sphereで構成し、主役には色面と細い輪郭を加えています。外部モデル・写真素材、認証やルーム通信は使用しません。

[演出確認動画（冒頭・落下・拡大・終幕、約7秒）](media/presentation-rehearsal.mp4)。Unityの実Timelineを24 fpsでサンプリングした抜粋です。各場面の長い発話待ちは省略しています。

## 共有アニメーション規格

演出の正本はPresentationDefinition v2のTimelineです。`packages/contracts/src/presentation/definition.ts` と `packages/contracts/proto/unframe/presentation/runtime.proto` に従い、`opacity`・位置・回転・スケールをミリ秒単位のキーフレームで指定します。イージングは `linear / cubicIn / cubicOut / cubicInOut` で、予備動作・静止・時間差・行き過ぎも同じキーフレームで表現します。TypeScript Core・Go Realtime・Unityに対応する補間実装があり、このリハーサル用に独自のアニメーション形式は追加していません。

ローカルの生成処理は共有schema・validator・Cue executorを使用し、Protobuf JSONのDeliveryとTimelineStartedイベントへ変換します。Editor再生はこのローカルデータを使うため、サーバー接続の検証とは別です。

既知の接続課題として、Go Realtimeの `internal/runtimecore/v2_initial.go` はTimelineの `easingToNext` を読み込みながら配信キーフレームへ転記していません。UnityのDelivery検証では非最終キーフレームのイージングが必須なので、この経路のデータは受け入れを拒否される可能性があります。バックエンド側で転記と回帰テストを別途修正し、通信経由の再現を検証する必要があります。この演出改修にはその修正を含めていません。ブラウザ上の再生一致も未確認です。

## Unity Editorで試す

Unity 6000.3.22f1で `app/unity` を開き、`Unframe > UI > Play Rehearsal in Editor` を選択します。未保存シーンの保存確認後、一時シーンでPlayモードになり、最初の場面を表示します。Gameビューをクリックして入力先にしてください。元のシーンやQuest用設定は書き換えません。一時シーンは保存不要です。停止後はProjectから元のシーンを開いて戻れます。

- **Next / Space / Enter / →**：次のイベント。アニメーション終了まで待ちます。モーション場面も手動で進めます。
- **Restart / R**：最初から再生。
- **Front / F**：正面の標準視点へ戻る。
- **Overview / O**：広角の全体表示。場面8の周囲のパネルなどを確認できます。
- **右ドラッグ**：回り込み。**中ドラッグ**：平行移動。**ホイール**：拡大・縮小。

この入口はEditor専用で、マーカー・Quest・サーバー接続なしで、現在のMotionPresentationデータと実際のTimelineを再生します。認証UI・マーカー校正・腕モーション認識・実機での見え方は、次のQuest用入口で別途確認します。

## Questでの操作

`Unframe > UI > Open Presentation UI Preview` で開き、`Present` から `Unframe rehearsal` を選び、マーカー校正後に開始します。Next / Aで通常進行し、Xで最初に戻します。下部のUP NEXTカードに次の腕モーションと操作が表示され、トリガー解放や再生待ちはSTATUS表示に切り替わります。モーションは使用する手のトリガーを保持し、動作後に離します。両手の動作ではどちらか一方以上のトリガーを保持します。

| 場面   | 表現・操作                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------- |
| 1〜5   | 濃紺の16:9パネルを固定。旧文章を消してから、短い間を空けて次の文章を表示                          |
| 6〜7   | テキストのみ                                                                                      |
| 8      | 中央から外側へ、時間差で広がる6枚のパネル                                                         |
| 9      | 空白。発表者が移動してから次へ                                                                    |
| 10     | 振り下ろしで5体が予備動作から加速落下。時間差で着地し、後からタイトルを表示                       |
| 11     | タイトルを消し、モデルのみ残す                                                                    |
| 12     | Next/Aで視線誘導の見出しを表示。指差し後、もう1回Next/Aで周辺を先に薄くし、固定の主役を中央へ誘導 |
| 13     | 空白                                                                                              |
| 14     | 振り下ろしで対象が重く着地。小さく行き過ぎてから静止                                              |
| 15     | 右へ横振り。逆方向へ小さく溜めてから、速く払い出す                                                |
| 16     | 両手を広げて拡大。一度縮め、素早く開き、ゆっくり整定                                              |
| 17     | 立体を消してから「『面白い』と、思えた。」を静かに表示                                            |
| 18     | 理由をまとめる文章                                                                                |
| 19     | 「身体 → 演出 → 空間」の流れを紹介                                                                |
| 20〜24 | パネルなし。旧文章を先に消し、短い間の後、次の文章が手前から減速して静止。最後は謝辞を残す        |

12は2段階のため、場面番号とイベント番号は途中から異なります。モーションイベントは10・15・16・17です。モーション場面もNext/Aで手動スキップできます。指差し認識やモデル選択は行わず、注目対象は事前に固定します。モデルの散らばり方も毎回同じです。

## 間と緩急

各操作は次の操作まで待つため、発表者が話す時間を自分で作れます。9・13の空白も維持しています。Timelineは650〜1700 msで、動き終わりに静止区間を置きます。10は5体を55 msずつずらして落下させ、着地後に文章へ視線を戻します。15の速い払いと16の大きな開きでは、予備動作・加速・小さな行き過ぎ・減速を別キーフレームにし、同じ速度で流れないようにしています。

字幕の切替は旧文章の退場を先に完了させ、新文章と重ねません。文字自体は回転・振動させず、読んでいる間は静止します。終盤は移動を小さくし、最終場面では長めに減速して謝辞を残します。実際の保持時間や身体との連動感はQuestでの確認が必要です。

## 表示とデータ

全体の配置・大きさを共通ルートのscale 0.5で縮小し、中心の高さを0.35m（従来より0.4m下）にしています。要素の奥行きは中心〜手前の範囲に収め、10のタイトルはモデルの間の中央に配置しています。基本パネルは縮小後1.7m × 0.95625mの16:9です。配色は濃紺・白・ミントを基調にし、大きな見出しと小さな章番号、短い本文で階層を作ります。周辺の立体は彩度を抑え、主役の輪郭と色面を際立たせます。見出し・本文は別テキストとして配置し、文字サイズと行間を分けています。必要な場面は左揃えにし、原案の言葉を主体にしています。ローカル描画では透明パネルによる文字の隠れを防ぐため、文字をパネルより後に描画します。文字は既存NativeUiの領域指定を使い、折り返しと一様縮小で余白内へ収めます。診断UIは標準で非表示で、`QuestArmMotionDebugView` の `Diagnostic Visible` を有効にすると再表示できます。

正本は `Assets/Resources/MotionPresentation/MotionPresentationDefinition.json`。共有v2 Cue/Timelineを既存Coreで実行して、`Tools/generate-motion-presentation.ts` がDelivery/Snapshot/Controlとモーション対応表を再生成します。旧生成Controlと対応.metaは再生成時に削除します。新しいControlの.metaはUnityでインポートして保存します。

```bash
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts
pnpm --filter @unframe/contracts exec tsx ../../app/unity/Tools/generate-motion-presentation.ts --check
pnpm --filter @unframe/contracts exec tsx --test ../../app/unity/Tools/motion-presentation.test.ts
```

変更後は `Unframe > UI > Open Presentation UI Preview` を実行して保存シーンへ割り当てます。APKは `Unframe > UI > Build Presentation UI Preview APK` で更新します。共有Definitionの構成を使用しますが、本番RenderBundleの作成やRealtimeへの接続を代替するものではありません。トリガー保持操作はUnityローカルのみです。

## 検証

Editor専用入口追加後のUnity EditModeは662件成功・失敗0件（実サービスが必要なE2E 2件はスキップ）。一時プロジェクトのPlayモードで25イベントの実時間再生、アニメーション中の追加入力拒否、最初からの再開、代表4場面のカメラ描画を確認しました。

2026-10-15の演出改修では、OpenCV有効構成のUnity EditModeは661件成功・失敗0件（実サービス環境が必要なE2E 2件はスキップ）、生成・Cue進行・Proto往復・演出の回帰テストは13件成功しました。代表7場面の途中・終点と、4場面の実Timeline動画をUnityから描画して確認しました。新しいAPKとQuest実機での見え方・身体とのタイミング確認は未実施です。

以前の演出（2026-10-09）ではUnity EditModeテスト585件と生成・Cue進行・JSON往復等のTypeScriptテスト6件が成功しました。型・フォーマット・meta整合性も確認済みです。代表場面のEditor描画で文字とパネル、モデル配置を確認しました。`nix run .#check` は既存CLIの保存・キャッシュ関連23件の失敗で停止しました。APK更新とQuest実機での読みやすさ・動作確認は未実施です。
