# scripts/

タスクの実処理を置くディレクトリです。公式な実行入口は `flake.nix` の apps で、`flake.nix` はここにあるスクリプトをラップします。

| ディレクトリ           | 役割                                           |
| ---------------------- | ---------------------------------------------- |
| `lib/`                 | 共有ヘルパ（パス定数 `paths.sh` など）         |
| `ci/`                  | 品質ゲート                                     |
| `contracts/`           | 契約生成と生成物の差分検査                     |
| `dev/`                 | 依存関係・Git hook のセットアップ              |
| `unity/`               | Unity Editor の起動と WebGL Preview build      |
| `presentation-sample/` | Unity Editor 向けサンプル配信                  |
| `runtime-host/`        | Cloud Runtime Host の起動・Go管理CLIの呼び出し |

```bash
nix develop
nix run .#setup
nix run .#check
nix run .#control-plane
nix run .#presentation
nix run .#unity-proto -- check
nix run .#realtime
nix run .#runtime-host
nix run .#runtime-host-deploy -- "$PWD/.unframe/realtime-release" t4ko
nix run .#runtime-host-funnel
nix run .#runtime-host-updater-setup
nix run .#runtime-host-update -- --check
nix run .#runtime-host-update
nix run .#runtime-host-funnel-deploy -- "$HOME/Library/Application Support/Unframe/Funnel" "$(id -un)"
nix run .#console
nix run .#local-editor
nix run .#audience
nix run .#audience -- fix
nix run .#audience -- dev
nix run .#audience -- preview
nix run .#lp
nix flake check
```

Audience の `dev` / `preview` は追加引数を package script へ渡します。LAN 公開は明示的に `nix run .#audience -- dev --host 0.0.0.0` を指定します。スマートフォンのカメラを使う検証には HTTPS が必要です。準備・実機検証手順は [Audience README](../app/web/audience/README.md) を参照してください。

GitHub Actions では `nixbuild/nix-quick-install-action` で Nix を導入し、`magic-nix-cache-action` で Nix store をキャッシュします。

Bun は `packages/config/bun.nix` で 1.4.2 に固定しています。1.3.13 ではブラウザ終了後の追加パイプの二重 close により、成果物の出力が `EBADF` で失敗するためです。開発環境と CI は同じ Nix toolchain を使います。対象 system は Linux x86_64 と macOS arm64 です。macOS の実機検証状態と隔離の保証差は [ADR-0026](../docs/decisions/0026-native-linux-macos-host-adapters.md) に従います。

`packages/contracts/` は Control Plane OpenAPI、Realtime Protocol Buffers、Presentation artifact schema の共有境界です。`nix run .#presentation` は `packages/unframe/` と配下の独立workspaceパッケージ、依存境界、配布物の公開API、契約fixtureの生成driftを検証します。`generate-valid-delivery.sh` は宣言Project fixtureを実Compilerと決定的な契約用Rendererで処理し、Browserには依存しません。このfixtureは実描画の受け入れ検証を代替しません。

後続のFixed Browser受け入れ処理は `examples/presentation` のcheckと実buildを2回行い、成果物のpathとhashを比較します。現在そのProjectは存在しないため、この処理を含む全体gateは完了できません。独立化の実装順と受け入れ条件は[移行計画](../docs/plans/unframe-independent-packages.md)を参照してください。

CLI の公開結果が不明な場合は、出力された操作の JSON を保持し、同じ認証情報で `publication-status '<操作のJSON>' <control-plane-origin>` を実行して照会します。照会は再公開を行いません。

Apple Silicon で C# consumer を生成・検査するには Rosetta 2 が必要です。固定した `Grpc.Tools 2.76.0` は macOS の x64 plugin のみを配布しています。未導入の場合は `softwareupdate --install-rosetta` でライセンスを確認してインストールしてください。platform 判定は `scripts/lib/grpc-tools.sh` で共有し、`bash scripts/contracts/test-grpc-tools.sh` で単独検証できます。

Presentation v2 の Unity C# bindings は `packages/contracts/proto/` の正本から `protoc` で生成します。Unity 側に置く `.proto` コピーと生成 C# の drift は次で確認でき、正本更新後は引数を省略して生成・同期します。

```bash
nix run .#unity-proto -- check
nix run .#unity-proto
```

`nix run .#check` と Unity CI はこの drift check を含みます。

Presentation 品質ゲートは一時ディレクトリを実パスへ正規化し、macOS の `/tmp` などの symlink を fixture の project root に持ち込まないようにします。

Fixed Browser の実機captureをローカルで試す前には、次を明示的に実行します。package 単体の unit test は Browser を起動しません。`nix run .#presentation` と、それを含む `nix run .#check` は provision 済み Browser を使います。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
```

browser binary は repository の `.cache/playwright` にのみ配置し、`playwright-core install chromium --only-shell` で provision します。
Nix devShell は両 OS に固定 Noto Sans CJK JP Regular の単独 OTF と runtime closure を提供します。OTF は上流の Sans2.004 配布物を SHA-256 で固定して取得し、SIL OFL ライセンスを同梱します。Linux では共有ライブラリと fontconfig も提供します。font probe は明示 font bytes で描画し、font / Browser / OS / runtime の識別を fingerprint に含めます。生成物の一致を保証する単位は同じ実行環境であり、異なる OS の PNG bytes を一致させる契約ではありません。
通常の renderer-web test は `*.integration.test.ts` を明示的に除外し、provision済み環境でだけ実 Browser capture の integration test を次で実行できます。binary がない場合は skip せず失敗します。`nix run .#presentation` の check mode も同じく provision を必須とし、fix mode と package 単体 check は Browser を起動しません。

Fixed Browser は Chromium sandbox を有効にして起動します。Docker の既定 seccomp のように namespace を作成できない container では sandbox を用意できないため、`UNFRAME_UNSAFE_CHROMIUM_NO_SANDBOX=1` を明示した場合に限り無効化できます。未設定や他の値では従来どおり有効です。sandbox なしで描画した成果物は信頼できる出力として扱わず、公開や再現性の検証には使用しないでください。

```bash
nix develop --command scripts/dev/test-presentation-browser.sh
```

Opaque React capture は Linux では user namespace と memory / pids controller を委譲できる systemd user manager、macOS arm64 では利用可能な Seatbelt policy と process group 監視を必要とします。macOS の監視は Linux の hard subtree limit と異なります。Browser の provision 後、次で native 隔離・資源制限・React / Base UI の CLI build を実行します。capability が欠ける環境では skip せず失敗します。

```bash
nix develop --command scripts/ci/opaque-capture.sh
```

通常の CLI 実行を同じ profile に入れる場合は、`nix develop` 内で `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" scripts/dev/opaque-capture-scope.sh <command> [arguments...]` を使います。Linux では delegated scope を作り、macOS では native adapter を直接使用します。Opaque integration は通常の package unit test から分離しています。GitHub Actions の AppArmor 許可は Linux の専用 step の executable path に限定します。

Presentation CI の型・lint・共通単体テスト、契約生成・wire 互換性検査、参照 project の二回 build は Ubuntu で実行します。Ubuntu の Opaque integration は `renderer`、`cli-project`、`cli-author`、`cli-styles` の独立した4ジョブで並列実行し、各ジョブ内は直列にして cgroup の回収検査との競合を防ぎます。macOS は native filesystem、Darwin の隔離・回収、固定 Browser・locked font の描画、native Tailwind worker の検証に限定します。各ジョブの上限は45分で、集約 CI はすべての成功を必須とします。

個別に実行する場合は `nix develop --command scripts/ci/opaque-capture.sh <suite>` を使います。Ubuntu 用の suite は上記4つ、macOS 用は `macos` です。引数省略時は、その OS の全 Opaque integration を実行します。

PostCSS / Tailwind を使う project の `unframe.lock` は native runtime と依存も固定します。OS を切り替えた場合は、移行先の同じ隔離 profile 内で `pnpm --filter @unframe/core run presentation lock update <absolute-project-directory>` を実行します。`lock refresh` では runtime を切り替えません。

## Native helper と worker の準備

CLI の path 検査、成果物公開、build cache、Source 保存 transaction は Go 製 native filesystem helper を使用します。repository root で `bash scripts/build-cli-filesystem.sh` を実行すると `packages/unframe/workspace-node/.cache/filesystem-helper` を生成します。native 専用 Go module の依存は `packages/unframe/workspace-node/native/go.mod` と `go.sum` で固定します。CLI の pnpm `presentation` / `dev` / `tui` / `test` / `test:tui` は hook で生成します。`vp test` の直接実行や headless API の直接利用など hook を通らない consumer は、先に同 script を実行してください。

Style / capture 共通の OS 別隔離・資源制限・終了確認は `unframe-worker-host` が所有し、Browser の配置と起動は Renderer、固定 Node graph の配置と Style 変換の準備は CLI が所有します。Linux / macOS の保証差と実機検証範囲は ADR-0026 を参照してください。

## Local Editor と Unity

Local Editor の開発は、Local Editor の `dev` と CLI の `dev` を別ターミナルで起動します。CLI の起動入口が OS 別の隔離経路と固定 Browser のパスを準備します。初回準備・起動順序・画面での確認手順は [Local Editor README](../app/web/local-editor/README.md#local-editor-の起動) を参照してください。

```bash
nix run .#unity-editor -- -projectPath "$PWD/app/unity"
nix run .#unity-preview
nix run .#presentation-sample
```

`presentation-sample` は `examples/presentation` を正式コンパイル・CLI公開し、localhostのControl Planeと
Realtimeを約20分起動します。`Sample ready for Unity Editor` の後にUnityの
`Unframe > Presentation > Play Local Sample in Editor` を選ぶと接続情報を自動読込して表示します。
WebGL playerは不要です。終了はCtrl+Cです。Quest用のLAN配信・マーカー校正は含みません。
詳細は [Unityの接続手順](../app/unity/docs/production-presentation.md) を参照してください。

`unity-editor` は Linux で `steam-run` を介し、macOS では native Editor を直接起動します。`UNITY_EDITOR` で実行ファイルを指定でき、未指定時は `app/unity/ProjectSettings/ProjectVersion.txt` の OS 別 Unity Hub 配置を使います。対応する Unity version のインストール、license と WebGL module は利用者が用意します。

`unity-preview` は共有 Runtime の描画・Preview 部分から `.unframe/unity-preview/project` を生成し、WebGL player を `.unframe/unity-preview/UnframePreview` に出力します。生成 Assets は再構成し、Library／build cache は再利用します。build log は `.unframe/unity-preview/logs/build.log` です。

共通再生処理と Preview の EditMode テストは `nix develop --command bash scripts/unity/test-native-editor.sh playback` で実行します。結果は `.unframe/local-editor-e2e/logs/playback.xml`、ログは同 directory の `playback.log` に出力します。 本番の共通再生・配信受信・Native UI・モデルの回帰は `nix develop --command bash scripts/unity/test-native-editor.sh rendering` を使用し、同じdirectoryの `rendering.xml` と `rendering.log` を確認します。WebGL PreviewはBaked描画と共通再生・検証だけを取り込み、本番専用のメディア実装を含めません。

Local Editor の品質ゲートは `nix run .#local-editor`（型検査・Node ロジックテスト・build）です。Local Editor の E2E と専用 Nix app は撤去しました。実 WebGL の画面・認証・公開操作は自動ロジック検証と分けて手動確認してください。
