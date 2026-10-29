# Audience リライト計画

更新日: 2026-10-30。Audience の実装担当者向けに、リライトの残作業と受け入れ条件を定める。現状は PR #208 の worktree を基準とし、main へのマージ済みとは扱わない。

## 現状

- PR #208 では Material UI・Tailwind の画面、参加・視聴状態の Zustand 化、共有 Hono RPC の利用、Runtime の状態保持と遷移の分離、素材受信の共通化と GLB の構造・ドメイン検証の分離を実装した。
- ローカルでは `nix run .#audience` の型検査・lint・テスト・build を確認した。後続の変更では影響範囲を再検証する。
- `nix run .#realtime-e2e` は Unity を使わない全7シナリオが成功した。途中参加、進行・停止、再接続、プロセス再起動・lease 期限切れ後の復旧、終了を実 gRPC／WebSocket とブラウザ描画で確認した。実 Unity Editor、iPhone Safari／Android Chrome、会場・公開環境の受け入れは未実施。main の競合は解消した。CI の状態は作業時に再確認する。
- 追加修正では視聴資源と接続の寿命を `audience-session.ts`／`viewer-application.ts` に移し、UI から資格を除いた。HTTP 応答スキーマ、十進整数・Quaternion、素材受信の検証を集約し、入力条件と従来のエラーを維持した。
- Comlink は既存の検出専用プロトコルを継続し、導入しない。同時1フレーム、画素の往復 transfer、timeout／破棄時の pending 拒否と terminate を独自に所有する必要があり、置換の効果が小さいため。実機受け入れは残り、実装済みの機能も受け入れ完了と同一視しない。

## 目的と範囲

PoC の既存構造を前提にせず、主要ロジックと外部契約を引き継いで `app/web/audience/` を組み直す。責務が集中する UI、接続制御、SDK adapter、Runtime store、素材処理を対象にする。既存ファイルや内部 API の互換性は要求しない。

匿名参加、カメラ開始、位置合わせ、待機・視聴、接続更新・復旧、終了・退出までを対象とする。PNG、opaque H.264 MP4、自己完結 GLB と現在の Runtime 対応範囲を維持する。対応形式・予算の正本は [Audience capability 定義](../../packages/contracts/src/presentation/audience-capability.ts) と関連する共有契約に置く。

参加 URL／QR、native-ui、Session 別会場設定配布、通信遅延の時計補償は、[接続・配信・実機受入計画](audience-web-app-plan.md) と [Room 管理と参加導線](console-room-participation.md) で扱う別項目とし、今回のリライトで暗黙に追加・完了扱いにしない。接続先の契約変更が先行した場合は整合させる。

## 確定した技術・UI 方針

- React、TypeScript、8th Wall、Three.js、AprilTag 3 WASM、js-aruco2 の POSIT/SVD を基本構成として維持する。js-aruco2 の辞書による印刷用マーカー生成も維持する。
- 状態管理は Zustand を採用する。ビジネスロジックを store に置かない。
- UI と操作導線は Material UI と Tailwind CSS を使い、Material Design に沿って設計する。Tailwind はレイアウト・余白・レスポンシブ対応に使う。
- カラーテーマは [Console](../../app/web/console/src/styles.css) を主な参照元とし、[LP](../../lp/src/app.css) と共通するブランドレッド `#df7b80`、ブルー `#7187f5` を引き継ぐ。LP のパープル `#9a80d0` は補助色の候補とする。Material Design の primary／surface／on-primary 等へ役割を割り当て、文字・背景のコントラストを確認する。
- ロゴ・アイコン・favicon は [assets/](../../assets/README.md) を正本とする。画面内マークは `icon.svg` を使用し、必要な素材を Audience 内へ原本と同一内容でコピーする。他アプリの素材を直接 import しない。
- 構造検証・パースは既存の Zod と共有契約へ委ねる。アプリ側はスキーマ制約とドメイン固有の整合性判定を担う。

## 引き継ぐコアと不変条件

主要ロジックのモジュール構造は変更できるが、以下の規則・計算結果を回帰契約として保つ。

- タグ姿勢推定、座標系変換、観測の鮮度・採用条件、曖昧性判定、表示専用の小揺れ補正。再認識で共有 `presentationOrigin` を書き換えない。
- Runtime を権威とする Snapshot、Control／State、sequence／fence、Group／Step、Timeline、Surface／media／model の適用。Viewer が Cue／Flow の進行判断を再実行しない。
- Snapshot の原子的適用、同じ assignment への再接続時の reliable sequence 下限、旧世代入力の拒否。Snapshot と素材の適用後に Ready を通知する。
- reliable gap では旧表示を除去して Snapshot を要求する。State delta gap では表示と Control cut を保持し、State を再接続して keyframe を待つ。
- 素材 URL のみの更新ではカメラ・読み込み済み表示・Runtime 入力を維持する。assignment 等の変更では旧入力を無効化する。Runtime 資格更新時の再接続と素材 URL 更新を区別する。
- 資格・URL の期限は利用時にも検査する。取消・退出・期限到達後に完了した HTTP、Worker、素材ロードの結果で状態を復活させない。
- 素材の MIME、受信サイズ上限、SHA-256、寸法、対応機能・資源予算を検査する。Venue Edge の素材資格は許可した接続先だけに付与する。
- 8th Wall がカメラと描画ループを所有する。同一フレームの画像・投影・姿勢を対応付け、共有 GL 状態の復元、decoder・model・GPU 資源の解放順序を維持する。
- Viewer の capability・入力権限を維持し、未対応の必須表現を黙って省略しない。資格・署名 URL・カメラ画像を通常診断へ記録しない。

## 責務と所有

| 担当                 | 責務                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| React UI             | 状態を selector で購読して表示し、操作をアプリケーション処理へ渡す                    |
| Zustand              | 確定した状態の保持・更新・購読。検証、通信、再試行、資源操作を持たない                |
| アプリケーション処理 | 参加・開始・更新・復旧・退出の手順、非同期処理の取消、セッションと資源の寿命          |
| コアロジック         | Runtime の整合性・状態遷移、姿勢推定、利用可否・予算判定。React／Zustand に依存しない |
| 外部接続             | HTTP、WebSocket、SDK、Worker、Three.js、ブラウザ API の操作                           |
| 診断                 | 各担当が発行したイベントの記録・出力                                                  |

接続、追跡、素材準備、視聴の状態を区別し、画面の状態を導出する。同じ状態の正本を controller と store の両方に持たない。Runtime のコア処理は状態と入力から次の状態・必要な処理を返し、状態保持から独立して検証できるようにする。

Socket、Worker、カメラ、Texture、動画 decoder、毎フレームの姿勢は UI store に格納せず、対応する担当が所有する。資格は通信担当のメモリに保持し、UI に公開・永続化しない。高頻度の描画更新で React 全体を再描画しない。

機能ごとに必要な責務だけを分離する。一律の階層、汎用イベントバス、通信・状態の万能フレームワークは導入しない。

## ライブラリと契約の扱い

- HTTP は既存の [共有 Hono RPC クライアント](../../packages/api-client-typescript/src/index.ts) を活用する。サーバーの `@hono/zod-openapi`、OpenAPI 生成型、クライアントの実行時検証を整合させ、型共有だけで検証済みと扱わない。必要な共通スキーマは共有契約に置き、ブラウザへサーバー実装を取り込まない。
- Realtime は既存 Protobuf と codec を使い、HTTP 契約と分ける。
- `runtime/runtime-input.ts`、`runtime/wire-view.ts`、`runtime/animation-view.ts` の符号なし整数の解析を調べ、意味が一致する箇所は共有契約のスキーマへ集約する。未指定値の既定、正規の十進表現、safe integer とエラー時の振る舞いを先に確認する。`idSchema`・`safeUIntSchema`・`contentHashSchema` も、入力の制約が一致する場合に再利用する。HTTP の URL path 用 ID など、より狭い制約は維持する。
- Quaternion の単位長と正規符号は既存の共有スキーマに任せられるとは仮定せず、wire 変換と共有契約の責務を確認する。意味を揃えて集約する場合は、未指定値・有限値・許容誤差・符号の規則を回帰テストで維持する。
- GLB 内 JSON の構造検証は Zod、参照整合・対応機能・資源予算は専用の判定に分ける。
- PNG／動画／GLB のサイズ上限付き受信・checksum 等は共通化し、形式固有の検証・デコード・解放は各担当に残す。
- Worker は既存の専用プロトコルを継続する。Comlink を採用しない理由は現状欄を参照。同時 1 フレーム、画素バッファの往復 transfer、timeout 時の terminate、破棄時の pending 処理を維持する。
- 姿勢推定の数値ソルバ置換は、精度・特異系・実機性能を比較する別の検証課題とする。Zustand 採用に伴って XState を必須依存にしない。

## 今後の変更でも維持する設計・記法の方針

- `experience/viewer-application.ts` に移した host／session の生成・破棄、Runtime 入力の接続、復旧、再接続手順を回帰テストで確認する。UI は表示と操作の受け渡しを担い、資源と非同期処理の寿命はアプリケーション処理が所有する。既存の復旧・取消・再接続の振る舞いを保ち、汎用フレームワークは導入しない。
- API・protobuf・GLB・素材の入力境界を見直し、既存の Zod、共有契約、codec、GLTFLoader、ブラウザ標準 API に委ねられる構造解析や基本検証を優先する。型共有だけで外部入力の検証を省かない。参照整合、権限、期限、対応機能、資源予算、資源解放は製品固有の判定として維持する。依存追加は既存の仕組みで不足する具体的な場合に限る。
- Audience で使う React 19、TypeScript、Zod 4 とブラウザの対応範囲に照らし、非推奨 API、不要な重複、より明確な記法を確認する。例えば `z.number().int()` と safe integer 上限の重複は [Zod 4 の `z.int()`](https://zod.dev/v4/changelog?id=int-accepts-safe-integers-only) で同じ制約を表せるか確認する。構文の新しさだけを理由に変更せず、[外部システムとの同期に使う `useEffect`](https://react.dev/reference/react/useEffect)、Promise、Worker／WebSocket の購読・取消を機械的に置き換えない。新しい API は導入済みバージョンと公式資料で確認する。
- 置換前に対象の入力と結果を回帰テストで固定する。欠落値、境界値、非正規値、取消・期限切れ・遅延応答、エラーと資源解放を検証し、入力が受理・拒否される条件を変えない。

## 実施項目と完了条件

1. **回帰契約の確認（自動検証済み）**
   - 現行コードとテストから、上記不変条件・外部挙動のテストを抽出する。旧内部構造に依存したテストは維持対象と分ける。
   - 状態の正本、各資源の所有者、更新・取消・解放の条件を決める。
2. **画面・テーマの確認（既存実装を維持）**
   - 参加、カメラ許可、位置合わせ、待機、視聴、復旧、終了・退出の導線と主要な失敗状態を確認する。
   - Material Design の部品、色・文字・余白の token、ブランド素材、Tailwind の役割を確認する。カメラ映像を中心に、不要な説明・セカンダリラベル・常設診断を抑える。
3. **参加・視聴経路の整理（実装・自動検証済み）**
   - Zustand とアプリケーション処理、共有 HTTP クライアントの接続を確認する。
   - 開発・テスト用の通信を使い、参加 → Delivery／bootstrap → Snapshot → コア処理 → Zustand → UI を検証する。
   - 期限切れ、取消、遅延した旧世代応答、sequence 欠落、assignment 変更を検証する。テスト用通信を製品の代替経路にしない。
   - セッションと接続の寿命管理を UI から分離し、共有スキーマ・ライブラリの利用と記法を見直した。Worker の取消・transfer・timeout の既存契約は維持した。
4. **追跡・描画の確認（自動検証済み・実機未確認）**
   - SDK、Worker、姿勢推定、PNG・動画・GLB・アニメーションが新構成で動くことを確認する。
   - 素材取得・検証・予算判定と描画資源管理の分離、および途中失敗・取消・置換時の解放を検証する。
5. **実通信・実機の受け入れ**
   - 実 WebSocket で途中参加、進行・停止・seek、再接続・再同期、資格・素材 URL 更新、終了を確認する。
   - iPhone Safari／Android Chrome で権限拒否、背景復帰、追跡低下・再認識、動画・音声・GLB の同時負荷、繰り返し入退室、長時間視聴と資源解放を確認する。
   - 対象端末、手順、測定値、残不具合を記録する。自動テストや過去の PoC 成果を、新構成の公開環境・実機受入の代わりにしない。
6. **旧経路の撤去と文書更新（文書更新済み・実機受け入れ待ち）**
   - 受け入れ条件を満たした後、旧 UI・CSS・controller・購読処理・不要なテストを削除する。恒久的な新旧切替・互換レイヤーを残さない。
   - fixture と診断は新しい製品処理を使う開発用入口へ整理する。README、接続境界、関連計画を実装と揃える。
   - PR の main との競合と CI／Cloudflare Workers build の状態を確認し、未解決の問題を解消する。

## 検証

振る舞いごとに探索 → Red → Green → Refactor で進める。コアの規則・計算は単体テスト、通信・SDK・資源の寿命は統合テスト、操作導線はブラウザ E2E で検証する。テストのためだけの内部 API は作らない。

反復時は変更に対応するテストへ絞る。リライト全体では `nix run .#audience` の型検査・lint・Audience の test／build と、該当する既存 `nix run .#realtime-e2e` シナリオを実行する。共有クライアントや契約を変更した場合は、その対象検証・生成物 drift 確認も行う。リポジトリ全体の test／build は remote CI に任せる。

完了には、新しい製品経路で現行対応機能と不変条件が成立し、旧経路を撤去し、必要な自動・実機受入の結果を記録することを要求する。実行できない検証は理由と残条件を明記し、成功扱いにしない。
