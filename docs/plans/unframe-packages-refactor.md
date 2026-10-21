# Unframe パッケージのリファクタリング

- 状態: 完了（実装・独立レビュー・受け入れ検証済み）。
- 対象: `packages/unframe-*`、Realtime transport、関連する契約・開発文書。

## 確定した責務と契約

- 低水準ファイル操作は Linux / macOS とも Go helper に統一した。directory FD、symlink 非追跡、完全書き込み、同期、終了時の解放を helper が所有する。別 directory 間の移動は固定した両 FD の `renameat` を使う。schema、checksum、cache key、保持方針、保存 transaction の状態は TypeScript が所有する（[ADR-0013](../decisions/0013-local-compiler-project-filesystem-contract.md)、[ADR-0026](../decisions/0026-native-linux-macos-host-adapters.md)）。
- Author は完了 job を最大64件保持し、完了順に対応する request ID と同時に削除する。実行中 job は保護する。削除済み job の照会は404、request ID の再送は新規要求として revision を検証する。画像 cache の保持とは独立する（[CLI Architecture](../../packages/unframe-cli/ARCHITECTURE.md)）。
- Core の runtime validator は既存の `string[]` API を維持し、Definition と入力を descriptor-safe snapshot 後に検証する。stable code/path を持つ `ValidationResult<T>` API との保証範囲を明記した（[Core Architecture](../../packages/unframe-core/ARCHITECTURE.md)）。
- Snapshot の投影・serialization 準備中の catch-up overflow は新 cut から最大3回・合計250 msまで再試行する。送信開始後は slow subscriber として終了する。assignment の既知の inactive / lease / fence 違反と authorizer 障害を区別する。Running 中の State keyframe は Anchor の有無によらず50 ms周期とし、Control より先着して破棄された frame も後続 keyframe で収束させる。接続ごとに原則20 fpsの full keyframe を送る負荷を伴う（[Runtime contract](../packages/CONTRACT_RUNTIME.md)）。
- `docs/packages/` と owning package の文書を現行のコマンド、Author API、Style worker、Preview 再生、artifact / wire の正本、Hit Region の所有境界へ同期した。未実装の目標と過去の測定は現在の実装・検証から区別する。

## 検証

- Linux: Core の全テスト・型チェック、Realtime の全テスト・race test / vet、Go helper の test / vet と CLI の対象回帰テストが成功した。
- Linux / macOS arm64 とも flake に固定された Go 1.26.4 で helper を生成した。macOS では helper の test / vet と、CLI の native filesystem / build cache / 保存 transaction / Author service の46テストが成功した。
- macOS Unity 6000.3.22f1: `unit` 4件、`regression` 62件、`playback` 10件、サービス連携 `e2e` 1件、`showcase` 2件が成功した。各 mode で生成 manifest、固定 Unity module、DLL と asmdef を使用した Editor 起動を確認した。WebGL Preview build、showcase の864フレーム・4 command、実時間の撮影検証と動画生成も成功した。
- code-reviewer の FIFO 読み取り停止の指摘は、非 blocking open と回帰テストで修正し再レビュー済み。docs-reviewer の指摘はない。
- Unity の静的チェックと managed dependency 検査、`nix flake check --all-systems --no-write-lock-file` は成功した。
- Opaque capture: native boundary は13成功・2 platform skip、Renderer は50成功・10 skip。CLI integration は18件成功（変更のない Style worker 10件と、fixture修正後の4ファイル8件）。
- Markdown の整形とローカルリンク・見出し参照179件の検査が成功した。
- 最終品質ゲート `GOCACHE="$PWD/.cache/go-refactor-check" nix run .#check` が成功した。削除済み Nix loader を参照する古い Go build cache の影響を避けるため、この作業専用の cache を使用した。

Quest 実機の受け入れ検証と `pauseTimeout` は [M6 の未完了事項](./presentation-packages-implementation-plan.md) で扱う。
