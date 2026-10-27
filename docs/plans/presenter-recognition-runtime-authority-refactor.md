# Presentation Runtime・Presenter認識の残作業

更新日: 2026-10-27。Presenter authority v3の移行と対象ローカル検証は完了。M6のQuest実機受入と `pauseTimeout` は未完了である。本書はRuntime・Unityの担当者が残る実装と受入を進めるための計画とする。

## 実装済みの範囲

- UnityがGesture 8種と腰位置によるZoneを認識し、割り当て済みRealtimeが入力文脈・権限・世代を検証してGuard／Cue、Action、時間進行、Step遷移を確定する。Poseは手追従などの連続演出に使う。
- input／command epochと同期ACK、Outcomeの記録・整理、同一IDの再送による二重実行防止、容量制限、checkpointと共有状態の同時保存・復旧を接続した。
- pause中は共有再生とAnchor表示を凍結し、途中参加・再接続・process recoveryでも保持する。resume後は有効なPoseの到着に従う。
- 到達済みStepの直近開始状態をpausedで一括復元し、Run ID・時計・参照・Timer・Cue消費を整合させる。Session clock、配送連番、認証・校正は巻き戻さない。
- Contracts、生成Go／C#／Unity consumer、Authoring、Compiler、Core、CLI、Local Editor、Control Planeをv3へ揃えた。旧契約へのadapterやfallbackは持たない。
- Quest用Scene、Pose／入力adapter、全体操作と到達済みStepの選択UIは実装済み。

契約と所有境界は [ADR-0027](../decisions/0027-presenter-recognition-and-runtime-authority.md)、[Presenter authority契約](../packages/CONTRACT_PRESENTER_AUTHORITY.md)、[配信・実行契約](../packages/CONTRACT_RUNTIME.md)、[Realtime Architecture](../../app/server/realtime/ARCHITECTURE.md)、[Unity README](../../app/unity/README.md) を参照する。

## 残る実装: pauseTimeout

期間・時計・自動終了policyが未定義であり、現在は時間経過による自動終了を実装していない。

- [ ] timeout期間、計時に使う時計、pause理由ごとの適用条件、自動終了の挙動を決定する。
- [ ] 再起動時の期限復元を含め、確定した仕様をRuntimeと必要な保存契約へ接続する。
- [ ] 期限の境界、resumeとの競合、終了後の入力拒否・再開不可をテストする。

実装と検証は [Realtimeのfollow-up](../../app/server/realtime/todo.md) と整合させる。

## 残る受入: Quest実機

Unity Editorの成功は端末の認識品質・通信・描画性能を代替しない。

- [ ] 実Control Plane／RealtimeからDeliveryとAssetを取得し、表示・入力・切断復帰を確認する。
- [ ] Gesture 8種、開始時の頭方向、両手競合、同一動作の重複通知を確認する。
- [ ] 2m Zoneの境界、腰trackingの欠損・復帰、復帰時の無通知seedを確認する。
- [ ] 校正・再校正、controller ray操作、入力同期、pause中の途中参加・表示凍結・resumeを確認する。
- [ ] 到達済みStepへの復元とMedia／Modelを含む再生位置・表示の整合を確認する。
- [ ] texture residency、GPU／CPU使用量、upload peakを計測する。

端末・実行環境・対象成果物とversion・手順・結果・残不具合を記録する。全項目の成功を確認するまで、Quest受入やM6全体を完了扱いしない。

## 検証済み範囲と実施方法

2026-10-25までの移行記録では、Contracts／wire、Core、Authoring、Compiler、CLI、Local Editor、Control Planeの対象テスト・型検査、Goの対象test／race・vet／lint、生成drift・breaking検査、C# wire conformance、Unityのdotnet harnessとEditMode対象96件が成功した。独立コード・文書レビューも実施済みである。

[PR #168](https://github.com/unframe-dev/unframe/pull/168) には修正後のGitHub ActionsとCloudflare buildの成功記録があり、依存する [PR #160](https://github.com/unframe-dev/unframe/pull/160) とともにマージ済みである。これらは当時の検証記録であり、今後の変更やQuest実機の成功を保証しない。

追加実装は失敗テストから進め、変更範囲のテスト・型検査・lint・buildを実行する。契約を変更する場合は正本から生成し、consumerのdriftを確認する。Unityの挙動変更には対象EditModeを実施する。全体test／buildはremote CIに任せ、未実施の確認を成功扱いしない。

## この計画の対象外

任意の未到達Stepへの移動、Presenter交代、Local PreviewのGesture／Zone／Anchor対応追加は含めない。Cloud／Venue Edgeのlifecycleやremote配置の運用課題はRealtime側のfollow-upで管理する。
