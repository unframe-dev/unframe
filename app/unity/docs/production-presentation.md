# コンパイラー成果物を本番Sessionで表示する

## 対応範囲とデータの流れ

現在のコンパイラーは Authoring Source（`presentation.unframe.tsx`、lock、Theme、Component）から
Definition、RenderBundle、AssetSet、BuildManifest、PNGとフォント素材を生成します。
Baked WebのState切り替え、Interaction、Cue、Timelineなどは宣言した内容を本番Runtimeが実行します。
モデル・動画・Native UIを含む契約JSON全体をコンパイルする機能は未実装です。
Unityのrendererが対応するメディア範囲と、コンパイラーが生成する範囲は異なります。

`packages/contracts/presentation/fixtures/presentation-definition.json` は契約のテストfixtureで、
現行コンパイラーの入力ではありません。`exact-definition-preview` と `media-demo` は手動生成した
検証データであり、正式なビルド成果物ではありません。それらの生成ツール・Package読込専用Runtime・
表示メニューは削除しました。以後は次の経路を使用します。

```text
Authoring Source → unframe-compiler → managed dist
→ CLI公開（素材の検証とuploadを含む）→ Control Planeの公開済みPresentation
→ Session / Delivery / Realtime → QuestPresentationScene
```

## `examples/presentation` をEditorで表示する

リポジトリルートのターミナルで起動します。

```bash
nix run .#presentation-sample
```

`Sample ready for Unity Editor` が出たら、そのターミナルを起動したままUnityで
`Unframe > Presentation > Play Local Sample in Editor` を選びます。
接続先、Session ID、credentialの手入力は不要です。変更中のSceneの保存確認後に一時Sceneで
Play Modeへ入り、終了時は元のScene構成を復元します。

起動コマンドは `examples/presentation` をprivateな作業ディレクトリへコピーし、正式なコンパイラーで
ビルドしてCLI公開します。隔離したローカルD1/R2、Control Plane、Realtimeを起動し、実APIでSessionと
Runtime割当を作成します。Unityは通常のDelivery・素材取得・Realtime同期・描画を使用します。
検証用管理者のログインSessionは、そのrunの隔離D1にだけ生成します。
公開・Delivery・bootstrapは既存の認証・権限チェックを通します。
手作業のDefinition変換やSnapshot生成は行いません。WebGL Build Supportはこのnative Editor表示には不要です。
初回の固定Browserの準備が済んでいない場合は、下記のインストールコマンドを先に実行してください。

Game画面では `Sync: ready` と `Playback: Running` を確認します。Resumeは最初に自動送信されます。
Pause／Resumeでサーバーの再生状態を確認でき、サンプル内の操作領域をクリックすると本番SurfaceInteractionを送ります。
`Continue`を押すとフェードし、操作を無効にした`Waiting`表示へ移ります。この例には後続の画面遷移はありません。
Frameでカメラを表示範囲へ合わせ、ExitまたはPlay Mode終了で接続を停止します。
Editorでは表示確認用の独立した座標を使います。Questのマーカー検出・校正の代替ではありません。

接続情報は `.unframe/presentation-sample/active-connection.json` に権限0600で保存し、Unityが自動読込します。
CAはこの接続のHTTP handlerだけに渡し、OSの信頼設定は変更しません。
credentialをSceneやPlayerPrefsへ保存しません。サンプル環境はlocalhost限定で、Questからは接続できません。

Sessionの有効期間は準備後およそ20分です。期限、Ctrl+C、サービス停止時に接続情報を削除します。
続ける場合はコマンドを再起動し、Unityで再びメニューを選びます。異常終了・SIGKILLで
`.unframe/presentation-sample/active.lock` が残った場合は、そのrunのプロセスが停止していることを確認してから削除します。
ログ・証明書・ローカル認証用データはprivate runディレクトリに残るため、共有・コミットしないでください。

## 1. プレゼンを個別にビルドする

リポジトリルートで実行します。初回は固定Browserを準備してください。

```bash
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command env PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" \
  pnpm --filter @unframe/unframe-cli run presentation build "$PWD/examples/presentation"
```

`examples/presentation/dist` はコンパイラーが管理するgenerationへのsymlinkです。
`definition.json`、`render-bundle.json`、`asset-set.json`、`build-manifest.json`、`assets/` を
まとめて扱い、JSONのhashや素材参照を手動で置き換えないでください。
この例のPresentation IDは `reference-presentation` です。
ビルドの成功だけでは公開やSession作成は行われません。

## 2. 公開とSessionの準備

既存のControl Plane・Realtime環境、公開権限のある有効なcredentialが必要です。
`UNFRAME_ACCESS_TOKEN` をプロセス環境へ渡した状態で、CLIの公開コマンドを使います。
次はControl Plane originを `UNFRAME_CONTROL_PLANE_ORIGIN` に設定した場合の例です。

```bash
nix develop --command pnpm --filter @unframe/unframe-cli run presentation publish \
  "$PWD/examples/presentation" reference-presentation "$UNFRAME_CONTROL_PLANE_ORIGIN"
```

CLIはdistのintegrityと実素材のchecksumを検証し、Build登録・素材upload・Publication確定を行います。
公開APIの成功後、Session lifecycle APIでそのPresentationを選ぶSessionを準備してください。
Session作成の権限・端末参加・Runtime割当の条件は [サーバーREADME](../../server/README.md) が基準です。
このUnity変更はサーバーのdeployや新しいSessionを自動作成しません。

## 3. Questアプリへの接続

Unityで `Unframe > Presentation > Open Quest Presentation` を開きます。
`Unframe > Presentation > Build Quest Presentation APK` が専用SceneからAPKを作ります。
Android Build Support、IL2CPP、ARM64、ArUcoを使う場合はOpenCVの準備が必要です。
回帰テストのfixtureは `Assets/Tests/EditMode/Editor/FixturesData` に置き、Playerには含めません。
旧ローカル用JSONの実行環境は削除しています。APKビルドはMetaのローカル接続設定を一時除外し、
成功・失敗の両方で復元します。

呼び出し元から `QuestPresentationSession.Connect` にHTTPS Control Plane origin、Session ID、
更新可能なcredential provider、必要ならlogical event名を渡します。
配信は `PresentationControlPlaneConnection` がDeliveryとbootstrapを取得し、
`PresentationBakedRuntime` が素材とControl/Stateの同期を検証します。
校正とSessionReadyが揃ってから表示・入力を有効にします。

Android launch Intentから `unframe.controlPlaneOrigin`、`unframe.sessionId`、
`unframe.credential`、任意の `unframe.advanceLogicalEvent` を渡す一時接続もあります。
Sceneにcredentialを保存しないでください。Intent経路はtoken更新機構を提供しないため、
継続運用には呼び出し元のcredential providerを使用します。
端末内ログイン・Session選択UI、iPhone用AR Sceneは未実装です。
校正と複数台の手順は [Session校正](session-calibration.md) を参照してください。

## 検証と診断

`nix run .#check` はリポジトリの品質ゲートです。
Unity描画と受信の回帰テストは隔離Editorでも実行できます。

```bash
UNITY_EDITOR="/Applications/Unity/Hub/Editor/6000.3.22f1/Unity.app/Contents/MacOS/Unity" \
  nix develop --command bash scripts/unity/test-native-editor.sh rendering
```

既存の `nix run .#local-editor-e2e` は、正式compiler build・公開・HTTPS素材配信・Realtime・
Unity native Editor描画を通すサービス受入テストです。
LinuxとmacOS arm64のnative実行経路を提供します。Linuxはsystemd/cgroup、macOSは
専用のfilesystem helper・Seatbelt・Chromium launcherを使用するため、Nixの正式な環境で実行します。
対応範囲と既存の受入結果は [ADR-0026](../../../docs/decisions/0026-native-linux-macos-host-adapters.md) を参照してください。
その記録と、作業中のUnity変更を含めた今回の検証結果は区別してください。
正式なWebエディターのWebGL previewと回帰テストは維持します。
ArUco単体診断は `Unframe > Diagnostics` に隔離し、本番入口と分けています。
Quest・iPhone実機の受入や会場ネットワークの確認はEditorテストとは別に必要です。

## 本番Sessionの接続・操作UI

通常は役割選択から端末コード認証、資料選択またはルーム参加へ進みます。
[アプリUIとモーション案内](quest-app-ui.md)に接続先の設定とデバッグ遷移を記載しています。
以下のEditor窓・Intentは、既存Sessionへの接続を直接指定する技術的な入口です。

### Editorで接続する

1. `Unframe > Presentation > Open Quest Presentation` を開いてPlay Modeへ入ります。
2. `Unframe > Presentation > Connect to Session` を開きます。
3. HTTPS origin（パスなし）、Session ID、有効なcredentialを入力してConnectします。
   任意の `Advance logical event` は対象プレゼンに定義されたlogical event名を指定します。

窓のcredentialはPassword表示で、接続開始時および窓を閉じる際に入力欄を消去します。
Scene、PlayerPrefs、ログへは保存しません。接続中のcredential providerはSessionのメモリでのみ保持します。
この窓とQuest Intentは渡されたcredentialの更新を行わないため、期限切れ時には有効なものを
再度渡してください。継続的な更新が必要なら `ConfigureConnection` に更新可能なproviderを渡します。

### Questで接続する

外部の起動元から前述のIntent extrasを渡すと本番Sessionへ接続します。
各extraは読み取り直後にIntentから削除します。通常の起動UIにはルームコード用の画面内キーボードがあります。
既存の呼び出し元は `Connect` を利用でき、接続設定と起動を分ける場合は
`ConfigureConnection` → `ConnectAsync` を利用します。
再接続は前の接続の停止完了を待ってから行い、`RetryAsync` は最新のproviderを使用します。

### 画面と操作

Quest向けの操作は[アプリUIとモーション案内](quest-app-ui.md)を参照してください。
発表者は大きな日本語メニューから再生・一時停止・次へ・終了を操作します。
Xでメニューを開閉し、メニューは開いた場所の前方に固定します。詳細情報と再接続は折り畳んでいます。
Viewerの観客メニューには位置合わせと必要な復帰操作だけを表示し、正常な鑑賞中にはUIを隠します。
ViewerをPresenterへ変更する機能ではなく、操作権限はRuntimeが引き続き制御します。

B/Yまたは「位置合わせ」で再計測、「カメラを許可」で権限要求を再試行します。
本番UIはカメラの診断パネルと診断入力を表示しません。
「発表を終了」は確認後にRuntimeへEndを送り、「接続を解除」は端末の退出です。
UIが閉じているときは資料のray操作を遮りません。

本番モーション案内はPresenter向けに配信された現在のgroup/stepの操作候補を表示します。
資料に指定されていない動作を推測して表示したり、Unityだけで操作成功を確定したりしません。

### 残る受入確認

Quest実機での照準・トリガー操作、HTTPS／Realtime接続、素材表示、マーカー校正、開始・停止・再開、
通信切断後の復帰、credential期限切れ後の再提供は実機未検証です。
Editorの回帰テストはこれらの実機受入を置き換えません。iPhone用AR入口は未実装です。
新しい端末コード認証・資料選択・ルーム参加の実サーバー通し試験も別途必要です。
