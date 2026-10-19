# Web と Local Editor の責務分離計画

- 状態: 計画。実装は未着手。
- 調査基準: 2026-10-20、`main` の `74fccbb2`。
- 目的: Local Editor を独立したローカル application に移し、Workers 向け Web を認証・公開済み Dist の確認・ルーム作成の入口に戻す。

この文書は今後の実施対象と受け入れ条件を定める。記載した移設先・新コマンド・検証経路は、現時点で利用できる機能として扱わない。実施後は完了項目を現行の README／設計文書へ反映し、この計画には未完了項目だけを残す。

## 目標の責務

| 所有先                                               | 責務                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `app/web` / `@unframe/web`                           | Workers 向け SPA。アカウント登録・ログイン・設定、device 承認、公開済み Dist の一覧・詳細確認、ルーム作成と作成結果の表示  |
| `app/local-editor` / `@unframe/local-editor`（新設） | ローカル専用 UI。Source の Inspector・保存・履歴、Dev／Dist build の要求、Unity Preview、Timeline 閲覧、CLI を通す公開操作 |
| `packages/unframe-cli`                               | ローカル filesystem、build・generation・Preview の管理、Local Host HTTP API、公開用 credential の保持、Dist のアップロード |
| Control Plane                                        | 認証・認可、Presentation／build／publication の永続化、素材の検証・R2 保存、Session の作成と参加・lifecycle                |
| Contracts / API client                               | 既存の artifact／公開 API 契約と型付き client。ローカル HTTP 契約は引き続き CLI が所有                                     |

Web Worker は SPA を配信し、ブラウザーの Web application が Control Plane を呼ぶ。Local Editor の静的 UI と Unity player は CLI Host が配信する。Web から localhost の filesystem API を操作する経路は設けない。

公開操作は既存の CLI／Local Editor 経路に残す。Web に新しいファイル選択・アップロード処理や Editor を追加しない。Local Editor の「表示した Dist」と現在の `dist` の一致確認、CLI headless publish、device 承認、PublicationFence による競合拒否は維持する。

「アップロード済み Dist の確認」は、Control Plane で公開が成立した Dist を確認する機能として実装する。素材送信だけ済んだ未公開 build、アップロード途中、公開失敗の履歴を管理する機能はこの計画に含めない。公開情報がない場合は「公開済み Dist なし」と表示し、「未アップロード」や「アップロード失敗」と断定しない。

ルームは既存 Control Plane の `Session` の Web 上の表示名とし、新しい Room 永続リソースは作らない。作成対象は公開済み Dist を持つ Presentation に限定する。参加 UI、Runtime 自動配置、発表開始・停止の運営 UI は別の作業とする。

## 現在の接続と不足

- 通常 Web は [router](../../app/web/src/app/router/router.tsx) と [Worker](../../app/web/worker/index.ts) を入口とする。認証・設定は Control Plane に接続済みだが、[Home](../../app/web/src/features/presentations/home-page.tsx) は Local Host の案内、[RoomsPage](../../app/web/src/app/shell/application-placeholder-pages.tsx) は仮画面である。
- Local Editor は [editor.html](../../app/web/editor.html) と [Vite 専用設定](../../app/web/vite.editor.config.ts) を持つが、ソース・依存・型チェック・テストは `app/web` 内にある。CLI は [start.ts](../../packages/unframe-cli/src/author/start.ts) から `app/web/dist-editor` を直接参照する。
- [公開 UI](../../app/web/src/features/editor/publication-panel.tsx) は Local Host に要求し、[CLI publish](../../packages/unframe-cli/src/application/publish.ts) が Control Plane へ送信する。Web に公開済み Dist の確認画面はない。
- Control Plane には Presentation の一覧・取得、[最新公開版の取得](../../app/server/control-plane/src/modules/publications/routes.ts)、[Session 作成・取得](../../app/server/control-plane/src/modules/sessions/routes.ts)がある。既存契約の利用を優先し、Web 用に別のデータ正本を作らない。
- Session は現在、未公開でも作成でき、作成時の最大 publication epoch を DB に固定する。ただし公開 API の Session resource は固定値を返さない。また、Ended でない Session があると再公開は競合する。この制約を Web の表示と作成条件へ反映する。

## 実施順序

### 1. Web が利用する契約と受け入れシナリオを確定する

- Presentation 一覧／取得と `GET /presentations/{presentationId}/publication` は既存契約を利用する。認証・認可、返却型、未公開と参照権限のない resource の扱いを確認する。
- Web の表示項目は既存契約で得られる Presentation 名・ID、build ID、publication epoch、artifact hash に限定する。ローカル path や Source は渡さない。
- 未公開の 404、認証切れ、権限不足、通信障害を区別する。読み取り失敗を空一覧や未公開扱いにしない。現在の一覧 API は全件応答なので、行ごとの公開情報取得は表示範囲に限定し、並行要求数を制御する。新しい一覧／summary API は本計画では追加しない。
- `POST /sessions` は既存の `{ presentationId }` 入力と、作成時の最新公開版を固定する方針を維持する。新規 Session は公開版が存在する場合だけ作成できるよう、DB の作成と同じ原子的な処理で条件を検査する。未公開の場合は既存の error envelope で `409 conflict` を返し、Session／participant を残さない。
- 作成／取得 response の Session resource に、DB に固定された `publicationFence` を追加する。現在の最新公開版を後から代入せず、保存された epoch の manifest から取得する。既存の公開版なし Session は `null` として表現する。既存 DB の `publication_epoch` と model の対応、OpenAPI・生成型・Hono client・直接 consumer を同じ変更単位で更新する。DB 制約を変える必要がある場合は新規 migration を追加する。
- Web の作成操作は「作成時の最新公開版を使う」と明示し、確認後に公開版が変わった場合も response の固定値を結果に表示する。選択時の古い build を使ったと表示しない。Ended でない Session による再公開の競合は維持し、Web が自動終了して解除する処理は追加しない。
- Join Code は作成 response で受け取る秘密情報として扱い、ログや URL に含めない。既存 API で再取得できない場合、再読み込み後の再表示を約束しない。

完了条件: 公開済み Dist の確認からルーム作成まで、利用 API・表示値・失敗状態・公開更新との競合条件が確定している。

検証: 既存 route／service／repository テストを確認し、不足する認可・publication 固定・競合の挙動は実装時に失敗するテストから追加する。fixture の UI テストだけでサーバー側の保証を代替しない。

### 2. Local Editor とその直接 consumer をまとめて分離する

- `features/editor` の Editor 本体・model・Unity bridge・CSS、`editor.html`、専用 Vite 設定、関連 unit／E2E を `app/local-editor` へ移す。通常 Web の Local Host 案内は Web 所有の画面へ整理し、Local Editor ソースを import しない。
- 新 package は `dev`・`build`・`check`・`test`・`test:e2e` を持ち、HTML entry は `index.html`、静的成果物は `app/local-editor/dist` に統一する。CLI の dev URL と直接 consumer も新 entry へ揃える。CLI は UI パッケージの実行コードに依存せず、その成果物を配信する。旧パスの fallback や互換コマンドは残さない。
- CLI の配信先・起動前確認・診断メッセージ・host fixture、直接呼出しテストを同時更新する。ローカル開発は Local Editor Vite → CLI Host の既存 proxy と token 認証を維持する。
- `app/web` から Editor 用の scripts・設定・テストと CLI／Core への不要な依存を外す。移設対象には `src/test/editor-dev.test.ts`、E2E の browser helper・showcase snapshot を含める。Web の Home／認証 E2E は残す。依存は新 package の実際の import に合わせ、`pnpm-lock.yaml` は pnpm で更新する。汎用 UI／HTTP パッケージは新設せず、favicon 等は利用先だけに配置し、Unity player の既存生成先も維持する。
- `scripts/local-editor/e2e.mts` の Editor build・成果物 path・browser helper import を更新する。同スクリプトの device 承認用 `@unframe/web` 起動は維持し、一括置換しない。
- `scripts/ci/local-editor.sh` と Nix の `local-editor` 品質入口、CI の path filter・workflow・集約 gate を追加する。`scripts/ci/check.sh` にも新 gate を含める。Web／Local Editor の型チェック・テスト・build を分け、CLI／Contracts／Core の変更でも Local Editor consumer の検証が選択されるようにする。`app/*` は既存 workspace 対象だが、新 package は既存 `@unframe/unframe-*` filter には含まれないため、暗黙の検証を期待しない。
- native filesystem helper の build 前処理を、CLI／Local Editor E2E の独立した入口ごとに保持する。固定 Browser の provision と OS 別の起動準備は既存 CLI／script の責務を維持する。

完了条件: 通常 Web が CLI・Compiler・Renderer・Local Editor に依存せず build でき、移設した Editor が保存・Dev／Dist Preview・公開を従来どおり行える。移設と起動／品質入口の更新を同じ実装単位にまとめ、consumer が旧パスを参照する中間状態を残さない。

検証: 移設した pure test と CLI Host テスト、両 package の型チェック・build、mock を使う主要 E2E を実行する。`rg` で `app/web/dist-editor`・旧 Editor entry／script 名・移設前 import の残存を調べ、Workers 向け build の entry と依存 graph を確認する。実 WebGL とローカル実サービスによる検証は手順5で別に実施する。

### 3. Web に公開済み Dist の確認を接続する

- `/home` を公開済み Dist の確認入口にする。Presentation 一覧と最新 publication を、既存 Hono RPC client／TanStack Query 経由で取得する。
- 一覧／詳細で対象 Presentation と公開 build ID・epoch を確認できるようにする。公開済み Dist がない状態、初回読込、失敗・再試行を扱う。
- 確認の正本はサーバーの publication とし、Local Editor の完了メッセージやブラウザー保存値から成功を推定しない。CLI 公開後に Web を開く／再取得すると公開結果が反映されるようにする。
- 認証・設定・device 承認は Web に残す。通常 Web の `/editor` 案内 route と Home の Editor 向け導線は、新しい管理導線に合わせて整理する。編集操作・Unity player・Local Host token は Web に持ち込まない。

完了条件: Local Editor を起動していないブラウザーからログインし、自分が閲覧権限を持つ Presentation の公開済み Dist を確認できる。公開情報の取得失敗と未公開を区別できる。

検証: API response から表示状態への pure test と、空・公開済み・未公開・401／403・通信失敗／再試行を通す Web E2E。CLI から再公開後の再取得で build ID／epoch が更新されることも確認する。

### 4. 公開済み Dist からルームを作成する

- Web で公開済み Presentation を選び、Session 作成 API を呼ぶ。`/rooms` の仮画面を作成導線と結果表示に置き換える。既存にない Session 一覧 API の存在を仮定しない。
- 作成結果に Session ID、対象 Presentation／固定 publication、Waiting 状態、作成直後の Join Code を示す。必要な詳細取得は既存 `GET /sessions/{id}` を使う。
- 作成中の二重送信を抑止する。応答不明の通信失敗では成功／未作成を断定せず、無条件の自動再送で Session を増やさない。未公開・権限不足・公開更新競合は API 契約に従って表示する。
- Web の選択制約だけに認可や公開状態の保証を任せない。手順1で確定したサーバー側の publication 固定条件をテストする。

完了条件: Web の確認画面からルームを作成でき、作成結果とバックエンドが保持する Session／publication の対応が一致する。更新や失敗時に別の Dist を対象としたと誤認させない。

検証: Session service／repository の対象テストと、Web の選択 → 作成 → 結果確認の E2E。未公開・他人の Presentation・認証切れ・二重クリック・応答不明・公開更新競合を検査する。Join Code の再表示条件も作成直後と再読み込みで確認する。

### 5. ローカル実サービスで二つの application を接続して検証する

- 既存 `scripts/local-editor/e2e.mts` を拡張し、CLI で project 初期化 → Local Editor で build・Dist Preview → Web で device 承認 → CLI 公開 → Web で公開済み Dist を確認 → Web 操作でルーム作成、を通す。
- 現在の E2E 内の Session 作成 API 直接呼出しを、Web の作成操作と作成結果に置き換える。認可・古い PublicationFence の拒否や、公開 artifact hash の検査は維持する。
- 作成した Session を既存 native Unity の Delivery／Realtime 検証へ渡す。Web の表示だけで upload 内容の整合性や端末読込の成功を判断しない。
- アカウント／session を seed するローカル試験と、実 Google OAuth・メール確認を通す試験は区別する。Workers の配信・cookie／CORS・認証 callback の確認は対象環境で別途行う。

完了条件: 分離後の Local Editor と Web が実 Control Plane／D1／R2 を介してつながり、公開した build と Web の確認値、作成 Session の固定値が一致する。

検証: 実 WebGL・ローカル実サービス・native Unity E2E を実行し、artifact hash、build ID、publication epoch、Session ID と検証結果を記録する。credential を含む実行 directory を成果物として共有しない。Quest 実機やクラウド配信の成功として扱わない。

### 6. 現行文書と配信設定を揃え、最終確認する

- `app/web`／新 Local Editor／CLI の README と Architecture、root README／AGENTS／ARCHITECTURE／CONTRIBUTING、scripts README、`docs/packages/` の Local Editor・Timeline・React Authoring・実行契約・DESIGN の責務とコマンドを揃える。既に古い `build:author` 等の記載も訂正し、accepted ADR の変更は後継判断への参照として記録する。過去の計画は一律に書き換えない。
- Workers の名前・HTML metadata・ナビゲーションを管理 Web の役割へ合わせる。旧 Editor 名の扱いは sibling infra の route／Worker 名 consumer と照合し、参照を残したまま改名しない。`.gitignore` の旧 Editor 成果物 path も整理する。
- 文書を独立レビューし、実装済み・未実装・未検証の境界を揃える。関連しない Runtime／Unity の機能拡張は含めない。

完了条件: 起動・配信・品質 gate・文書が二つの application の責務と一致し、未解決の検証は明示されている。

## 検証コマンドと実施時点

以下は実装時の検証計画であり、この計画の作成で実装・デプロイ済みにはしない。

| 時点                     | コマンド／確認                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 各変更の反復             | owning package の対象テスト・型チェック。新しい挙動は Explore → Red → Green → Refactor。移設だけの箇所は既存テストを移し、静的 UI に追従するだけのテストは増やさない                             |
| 手順2以降                | `pnpm --filter @unframe/web run check`・`test`・`build`・`test:e2e` と、新設予定の `@unframe/local-editor` の同名 scripts。Local Editor build は CLI 配信テストより先に実行                      |
| API 契約変更時           | `nix run .#control-plane`、Contracts の既存生成／drift check、TypeScript client check。契約・生成物・consumer を同時確認                                                                         |
| 実 WebGL 確認            | `nix run .#unity-preview` で player を準備し、新 Local Editor package の実 WebGL spec を `UNFRAME_REAL_WEBGL=1` で実行。固定 Browser と OS 別の隔離要件を満たす                                  |
| 手順5                    | `nix run .#local-editor-e2e`。seed 済み認証を使うローカル統合試験として記録                                                                                                                      |
| Nix／CI 入口更新時       | `nix flake check` と変更した領域の gate。CI path filter が Web／Local Editor／CLI／contract の変更を正しく選択するか確認                                                                         |
| 全変更後・実装コミット前 | `nix run .#check` に新 Local Editor gate を含めて実行。`git status`・差分・生成物を前後で確認                                                                                                    |
| Workers 配信確認         | 通常 Web の `pnpm --filter @unframe/web run cf:deploy:dry-run`。別途、対象を定めて配信した環境で認証・公開済み Dist 確認・ルーム作成をブラウザー確認。dry-run を実配信・OAuth 成功の証拠にしない |

この計画のコミットでは文書レビュー、相対リンク確認、差分確認と既存のコミット前品質 gate を行う。移設後のコマンド、実サービス E2E、Workers 配信、OAuth、Quest の確認は実装後の検証として残す。
