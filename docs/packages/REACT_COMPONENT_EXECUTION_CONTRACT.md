# React Component の抽出・編集・capture 契約

- **Status**: ローカル Authoring の実装契約。静的抽出、全 State capture、共有値の局所編集・Undo / Redo、保存 transaction と Inspector preview を実装済み
- **Related**: [作者向け API と工程](./REACT_COMPONENT_AUTHORING.md)、[ADR-0019](../decisions/0019-single-file-react-component-authoring.md)

この文書は、ローカル Authoring の入力、失敗、保存・実行方式を定める。提供範囲と検証記録は [作者向け文書](./REACT_COMPONENT_AUTHORING.md#6-受け入れ検証と導入条件) を参照する。publish / Delivery・端末側の接続は対象外とする。

## A1 の前提契約：canonical Surface

変更前の [SemanticSurface](../../packages/contracts/src/presentation/definition.ts) は `rootFrameId` / `contentNodes` を必須とし、当時の [Core validation](../../packages/unframe-core/src/validation/definition.ts) は全 Semantic Node と Content Node の一対一対応を要求する。[Renderer の出力検証](../../packages/unframe-renderer-api/src/execution/plugin-execution.ts) も `ownedContentNodeIds` を経由して Interaction の意味を検査していた。空の root Frame と独立した Semantic Tree だけではこの契約を満たせなかった。描画と一致しない仮の Text / Frame を追加してこの条件を満たす方法は採らない。

[ADR-0020](../decisions/0020-structured-and-opaque-surface-content.md) により、canonical Surface の `content` を次の二種類に明示的に分ける。

| 領域                | Structured                                           | Opaque                                                          |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| 描画内容            | 既存の Content Tree と layout を保持                 | 内部 Content Tree を持たず、宣言済み意味への binding 対応を保持 |
| 共通の意味          | Semantic Tree / State / Interaction / host placement | 同左                                                            |
| 検証                | Content Node と Semantic Node の対応を維持           | binding の一意性・全対象の対応・State ごとの有効性を検証        |
| Renderer の所有範囲 | Content Node 単位                                    | 初期は Surface 全体と宣言済み semantic binding                  |

React source / 実行可能 module は Compiler の描画用入力に留め、portable Definition や Runtime に渡さない。Opaque の geometry は capture が解決する。Structured の描画・意味の保証を緩めず、Opaque の形式を偽の Structured Tree で代用しない。

この方針では A1 の先頭に Contracts / Core / Renderer API の変更を追加し、Architecture の Content Tree 必須規則を Structured に限定する。既存 Structured の意味は維持するが、WIP の v2 schema は改訂し、`content: {kind: "structured", rootFrameId, nodes}` または `{kind: "opaque", bindings}` を必須とする。同一 bytes の維持を前提にせず、既存 Source から再ビルドする。旧形式への暗黙 fallback は追加しない。契約確定時に schema、Core validation、Renderer input / Hit Region 検証、integrity、fixture の移行を一組の受け入れ条件にする。

共通モデルを変更しない場合、A1 の canonical lowering / CLI check 成功という完了条件を維持できない。別案は抽出・capture の隔離試作までに範囲を縮め、canonical / Editor 接続の前に再度設計することである。元の縦断検証目標に沿い、共通モデルまで拡張する方針を採用した。

## 0. Lock v2 と生成 ID

`unframe.lock` は self-contained な canonical JSON の v2 に変更する。Source 正本の local files は lock に複製せず、root-relative path と bytes hash で固定する。外部依存は文字列・binary とも bytes を lock に含める。概略型は次のとおりであり、unknown field、重複 key、不正 UTF-8 / base64、未参照の外部 package、欠けた参照は拒否する。

```ts
type Hash = `sha256:${string}`;
type FileInput = { path: string; hash: Hash };
type LockedFile = {
  path: string;
  mediaType: string;
  hash: Hash;
} & ({ encoding: "utf8"; data: string } | { encoding: "base64"; data: string });
type PackageSnapshot = {
  key: Hash;
  locator: string;
  name: string;
  version: string;
  contentIntegrity: Hash;
  files: LockedFile[];
  exports: {
    subpath: string;
    runtimeImport: string | null;
    runtimeRequire: string | null;
    types: string | null;
  }[];
  dependencies: { specifier: string; usage: "runtime" | "types"; packageKey: Hash }[];
};
type ComponentOrigin =
  | { kind: "local"; entryFile: string; files: FileInput[]; sourceHash: Hash }
  | { kind: "package"; packageKey: Hash; subpath: string };
type ComponentLock = {
  componentId: string;
  version: number;
  origin: ComponentOrigin;
  manifestHash: Hash;
} & ({ mode: "structured"; structureHash: Hash } | { mode: "opaque"; rendererInputHash: Hash });
type UnframeLock = {
  schemaVersion: 2;
  packageSnapshotProfile: "pnpm-lock9-locator-v1";
  resolutionProfile: "browser-import-production-types-v1";
  extractionProfile: "react-component-v1";
  packageManagerLockHash: Hash;
  rootDependencies: { specifier: string; usage: "runtime" | "types"; packageKey: Hash }[];
  packages: PackageSnapshot[];
  dependencyGraphHash: Hash;
  themeHashes: { themeId: string; hash: Hash }[];
  componentLocks: ComponentLock[];
  assets: { id: string; mediaType: string; hash: Hash; size: number; dataBase64: string }[];
};
```

`Hash` は実検証で SHA-256 の小文字 hex 64 桁に限定する。file hash は decoded bytes、宣言・record の hash は既存 canonical serializer を使用する。path は ADR-0013 の root 内 regular file 規則を使う。package 内 path は package root 相対とする。file / export / dependency 配列はそれぞれ path / subpath / `(specifier,usage)`、package は key、Component は `(componentId,version)`、asset は id の code-unit 順とし、一意性を検査する。

`locator` は pnpm lockfileVersion `9.0` の `snapshots` record key をそのまま使用し、解決済み peer context を省略・並べ替えしない。OS の絶対パスを含む locator は拒否する。profile が違う pnpm lock は明示 update の段階で拒否する。key は `hash(["pnpm-lock9-locator-v1",locator])`。importer と usage ごとに bare specifier を dependency edge に解決し、型だけの依存は runtime graph に入れない。`@types` の対応も types edge として固定し、build 時に自動検索しない。

export subpath は常に `"."` または `"./..."` を明示する。runtime import は browser / import / production / default、静的 require は browser / require / production / default、型は types / import / default の固定条件で package.json の順序規則に従って解決し、最終 file path を exports 表に保存する。三 target の少なくとも一つを必須とする。exports がない package の root は、型は types / typings、runtime import は文字列 browser / module / main、runtime require は main の順で明示 file を選ぶ。対象 subpath を列挙して固定し、未固定の directory / index 探索は build 時に行わない。browser object mapping、exports の配列・ワイルドカード、`#` package import alias、未解決の動的 require / import は初期非対応とする。

条件解決を通常 build で再実行して node_modules に問い合わせない。local import は relative path のみ、bare specifier は固定 rootDependencies のみとし、任意 tsconfig paths / bundler alias は初期非対応にする。

package 内の relative import は locked files のみとする。初期実装では `#` alias を持つ実行依存を diagnostic で拒否する。必要な package が使う場合は snapshot の表現を拡張してから対応し、暗黙 fallback はしない。

| Hash                         | 対象                                                                                                                                        | 含めないもの                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| contentIntegrity             | 自 package の name / version / 全 files と解決済み exports                                                                                  | 自 key / integrity、依存先 integrity             |
| dependencyGraphHash          | 整列した rootDependencies と、各 package の key / locator / contentIntegrity / dependency edges、resolutionProfile / packageSnapshotProfile | capture、hash field 自身                         |
| local sourceHash             | Component entry と到達する local static / render / CSS / asset files の `(path,bytes hash)`。Structured は Manifest と Structure を含む     | Presentation 配置、lock 自身、外部 package bytes |
| manifestHash / structureHash | source metadata を除いた生成宣言                                                                                                            | render 関数、source range                        |
| rendererInputHash            | extractionProfile、抽出 renderer AST、local 描画依存の bytes hash、runtime edge で到達する package graph、固定 bundle tool identity         | capture output、wall clock、型専用 package       |
| project revision             | config・対象 Source・lock の bytes hash snapshot                                                                                            | staging path、process ID                         |

package dependency の循環は edge graph として扱い、依存先 integrity を再帰計算しない。異なる peer context は異なる key になる。locked bytes / exports を改変すれば contentIntegrity、runtime 依存辺の付け替えは dependencyGraphHash と rendererInputHash が変わる。型専用 graph の変更は project revision / 型検査に反映し、描画専用 hash から除く。ただし runtime package と同じ snapshot に含まれる型 file は contentIntegrity の変更として保守的に再描画対象にする。Renderer の Browser / font / capture profile は build environment hash に含める。lock 内に lock 全体 hash は保存せず、自己参照を避ける。

通常 check / build は全 hash と参照を再計算する。実装済みの `lock refresh` は固定 graph を保持し、`lock update` は `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --force --verify-store-integrity` 後の依存を読み直す。workspace / link 依存の配布 snapshot は未対応であり、明示的に拒否する。reference fixture の SDK は手製の型 snapshot で、実 package 配布の検証を示さない。`lock refresh <project>` は現在の固定 package graph で local Component / Theme hash だけを更新し、`lock update <project>` は明示された pnpm frozen install の結果から外部 bytes / exports / graph を再 snapshot する。どちらも package install script を実行しない。packageManagerLockHash は解決元 `pnpm-lock.yaml` bytes の SHA-256 で、更新時だけ読む。新しい外部 import を local refresh で追加した場合は依存更新を要求する。描画が必要な image/font は lock asset carrier または local files / package files のどれか一つから解決し、bytes と拡張子・mediaType を一致検証する。初期 capture の対応形式は4節で限定する。

Compiler の `ComponentPackageLock` / assembly carrier はこの origin + mode union へ移す。ローカル Component に架空の packageVersion を補わない。Structured の既存 Instance にある packageLock と sample の lock import を取り除き、catalog が origin を決定する。同じ `(componentId,version)` に異なる origin / 内容が解決したら重複定義として拒否する。旧 v1 の読み込み分岐は追加せず、loader、carrier、guard、`sameLock`、reference、fixture、drift test を A1 で一緒に更新する。Structured の宣言と canonical 出力の意味は維持する。

React 経路の生成 ID は、既存の portable ID 制約に収まる `r:` + SHA-256 hex とする。hash input は `JSON.stringify(["react-component-v1",kind,instanceId,localKey])`、kind は `host / surface / semantic / interaction / action / output / state`。host / surface の localKey は空文字で、公開 record key と namespace を混同しない。文字列を区切り文字で直接連結しない。生成後は既存の ID 一意性検査も行う。Component の version、ファイル移動、並べ替え、Props 変更では同じ Instance の ID は変わらず、Instance ID の rename は明示的な identity 変更になる。既存 Structured の ID 算出は変更しない。

既存 v1 project の移行は、Source を新しい宣言形式へ明示更新した後、`lock update <project> --recreate` で行う。この操作は旧 lock を入力として解釈せず、Source、project 設定、固定した pnpm 解決結果から v2 全体を新規生成する。旧 lock にしかない asset / package bytes は継承しないため、再生成可能な入力へ明示的に戻す必要がある。新 lock の全検証が成功した場合だけ旧ファイルを置換し、失敗時は旧 bytes を保持する。通常の update / refresh / check / build は v1 を拒否してこの手順を案内する。A1 は v1 fixture からの明示再生成成功と、入力不足・検証失敗時の旧 lock 保持を検証する。

## 1. Source の分類と抽出

Compiler は一度 snapshot した project / package files に対し、次の role を symbol の依存関係から割り当てる。

| Role        | 許可する内容                                                       | 利用者                                         |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| static      | 既存 Static DSL の const / literal / import / spread、許可 builder | Presentation と公開契約                        |
| render      | React 関数、描画 helper、描画用 package import、CSS / asset        | 抽出 renderer のみ                             |
| shared data | static として解決できる JSON 値                                    | static で解決し、renderer には値のコピーを渡す |

`*.component.tsx` は一つの named export `defineComponent` を持つ。初期形は直接の object literal と inline arrow `render` であり、root object 自体の spread や別関数への render 差し替えは拒否する。各 static field 内の既存 spread は認める。render の free variable を走査し、static value は canonical JSON literal、描画関数は依存順の宣言、import は解決済み virtual module 参照へ置き換える。

同じファイルの top-level は import、type 宣言、static const、描画用 function / arrow const、Component 宣言に限る。トップレベルの実行式、`makeValue()` による mutable cache、getter、再代入は拒否する。描画 helper の module は通常の TS/TSX として bundle できるが、public contract module を実行時 import できない。helper の初期化コードは隔離 Browser 内でのみ実行する。shared data として解決不能な値を static 側が参照したら diagnostic にする。

静的宣言の値を取るために module / SDK builder を実行しない。元 Component module 全体の bundle を tree-shaking に任せる方法も使わない。新しい virtual entry を作り、公開契約の initializer を物理的に含めない。元 Source との range 対応は、static field、render body、抽出 helper、Instance 宣言、値の定義元 / Instance 内の override 位置を区別して保持する。

描画例外の位置は、Browser から返る生成 JS の行・列をホスト側の SourceMap と既知の描画 module に照合し、元 Source の位置へ戻す。SourceMap と元 Source は診断用としてホストに保持し、Browser 入力や配信 assets に含めない。例外の raw stack / message は転送しない。未知の module や範囲外の座標は位置なしの描画診断にする。位置は診断表示にだけ使い、保存先やファイル操作の権限として扱わない。作者のコードが例外の stack を書き換えた場合、その位置の真正性は保証しない。

React JSX と Structured JSX は別の TypeScript Program で検査する。静的 Program には Component の型付き descriptor facade を、React Program には公開契約の型と描画依存を与える。plain Declaration Graph に関数や React element は入れない。型検査成功は static syntax / Zod / Core 検証の代わりにならない。役割不明の import、循環する static 値、未固定 package、実 filesystem への fallback は拒否する。

三例の render に渡す `texts` は、State override 解決後・membership 除外前のすべての基底 text key を持つ readonly string map とする。`included:false` は完成 Tree と有効 binding 集合からの除外を意味し、型が string なのに実値が undefined になる設計にはしない。`bindings` も基底 key を型として持つが、除外済み key を描画すると capture を拒否する。

## 2. Editor host と通信

初期 host は `unframe author <absolute-project-directory>` で起動する Linux ローカル process とし、同じ process が静的な Editor assets と内部 HTTP API を配信する。任意 origin の既存 Web ページを localhost の読み書きへ接続する構成は採らない。Web の UI は `app/web`、process / filesystem は CLI、pure command と patch は Compiler が所有する。API 型はこのローカル境界の所有 package に置き、Control Plane の公開 API や Realtime wire を変更しない。

loopback IPv4 のランダム port に bind し、期待する `Host` を完全一致で検査する。起動時の 256-bit session token を起動 URL の fragment で Editor に渡し、Editor は取得後すぐ URL から除去してメモリだけに保持する。API / artifact の読み取りも `Authorization: Bearer` を必須とする。token を query、cookie、永続 storage、ログへ保存しない。state-changing request は同一 Origin と JSON content type を必須とし、CORS は許可しない。host 再起動で token は失効する。

レスポンスは camelCase、未知 field は拒否し、`Cache-Control: no-store` を使う。project path を request から指定させない。一つの host が起動時に選択した一つの project だけを扱う。

| Method / path                                   | 入力と結果                                                                                                                         | 競合 / 再試行                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/project`                              | `200 {revision, sourceHash, irHash, instances, diagnostics}` と ETag。instances は公開 Prop schema / 値、Transform、編集可否を持つ | 読み取り。raw source 全文や secrets を返さない                                                           |
| `PATCH /api/project`                            | `If-Match`、`{commandId, expectedIrHash, command}` → `200 {revision, sourceHash, irHash, commandId}`                               | revision 不一致は 412。commandId は project 内で一意、同一 body の再送は保存済み結果、異なる body は 409 |
| `POST /api/builds`                              | `If-Match`、`{requestId}` → `202 {buildId, revision, status:"queued"}` と Location                                                 | 同じ requestId / body / revision は同じ job。revision 不一致は 412、別 build 実行中は 409                |
| `GET /api/builds/{buildId}`                     | `200 {buildId, revision, status, diagnostics, artifacts}`                                                                          | `queued / running / succeeded / failed / cancelled / stale`。初期 UI は 1 秒間隔で poll                  |
| `PUT /api/builds/{buildId}/cancellation`        | 空 object → `200 {buildId, status}`                                                                                                | 繰り返しても同じ取消意図。既に terminal なら状態を変えない                                               |
| `GET /api/builds/{buildId}/artifacts/{assetId}` | 成功済み job の catalog に存在する asset bytes                                                                                     | arbitrary path / Source / renderer JS を配信しない。Editor は認証付き fetch の結果を blob URL で表示     |

`command` は `setProp {instanceId, propId, value}` または `setTransform {instanceId, transform}` の discriminated union。scalar は string / finite number / boolean、Transform は全 position / rotation / scale を持つ。削除、rename、任意 patch / filename は受け付けない。A4 で追加する Undo / Redo は host が保持する同一 session の逆 command と新しい commandId / revision を使う。

commandId / requestId / buildId は 128-bit random を表す lowercase hex 32 桁に限定する。path に入れる前に strict 検証し、値を directory traversal や任意 filename として解釈しない。assetId は canonical catalog の key へ照合し、decoded 値を filesystem path に連結しない。

ETag / revision は config、全対象 Source bytes、lock bytes の sorted snapshot hash から作る。`irHash` は検証済み semantic IR の hash で、source metadata を除く。whitespace 編集でも古い command を拒否する。source が invalid の場合は診断付き snapshot を返し、`irHash` と編集値を null として GUI 保存を拒否する。

error は `{code,message,details:[{path,reason}],retryable}`。400 は形の不正、401 は token、403 は Origin / Host、404 は未存在 job / asset、409 は commandId 衝突・busy・保存回復待ち、412 は revision / IR の不一致、422 は意味検証、413 は入力上限、500 は I/O。422 / 412 は自動 retry しない。応答不明の保存は同じ commandId と同じ body だけで再送する。別 commandId での自動再送はしない。

初期 transport limit は command JSON 256 KiB、同時 build 一件。これはローカル処理の保護値であり、Presentation の最大規模を定義しない。公開文書 snapshot が大きい場合は既存 Compiler の project limit で拒否する。build job と POST の再送記録は host session 内で保持する。再起動後の不明 job は 404 とし、Editor は project を再取得する。保存 command の成功 receipt は次節のとおり永続化する。

切断で保存を途中取消ししない。build は明示 cancel または host 終了まで継続する。保存成功で古い build は cancel 要求を受け、新 revision の job を明示作成する。遅れて返った古い成果物は preview を置き換えない。build が生成を終えても、現在 revision が違えば `stale` とし、`dist` を更新しない。

## 3. Source 保存の transaction

root の通常ファイルを正本として維持し、GUI 専用 override 文書は作らない。協調する check / build snapshot / lock 更新 / GUI 保存は `.unframe-source.lock` の exclusive lease を共有する。build は既存 build lease → source lease の順で取得し、snapshot 後に source lease だけ解放する。保存は source lease だけを取得し、release 後に build を要求する。公開直前の build は source lease を取り直して revision を検証する。

GUI の一 command は一つの Presentation source と `unframe.lock` だけを変更する。新しい bytes をメモリ上で patch → static validation → local lock 更新し、既存ファイルを変更する前に検証する。共有 const は変更せず、Instance 内に literal / 末尾 override を追加する。根拠となる source location は再 parse した最新 snapshot から取り、古い offset を再利用しない。

project root から `.unframe/authoring/transactions` / receipts / staging まで、全 parent が non-symlink directory であることを directory descriptor と no-follow open、device / inode / owner 再検証で確認する。専用 `.unframe/authoring` 以下の directory は mode 0700、Source の before / after bytes と journal / receipt は mode 0600、作成は exclusive とする。専用 directory の許可が広い場合は処理を拒否し、勝手に既存 project の permission を変更しない。root と既存 `.unframe` に 0700 は要求しない。journal の読み込み時も同じ path / owner / hash 検証を行う。

1. source lease 取得後に expected revision / IR hash と対象 file identity を再検証する。
2. `.unframe/authoring/transactions/<commandId>/` に対象 path、before / after hash、before / after bytes、request hash、`prepared` journal を exclusive 作成し、file と directory を fsync する。path は root 内の既存 regular file に限定する。
3. 元 hash / file identity を再確認して `applying` を fsync する。以後 cancel は commit / recovery が終わるまで待つ。
4. 同じ filesystem 上の staging から Source、lock を順に atomic rename し、各親 directory を fsync する。最後に pair の after hash を再検証する。
5. `committed` journal と command receipt を fsync して成功を返す。receipt は request hash と保存後 revision を保持し、再起動後も同じ commandId の再実行を防ぐ。

`prepared` までの失敗は元ファイルを変更しない。`applying` 中の失敗・crash は lease 取得後の recovery で before pair へ戻す。ただし各対象が journal の before / after hash のどちらでもなければ外部編集として停止し、自動上書きしない。committed の receipt が欠けた crash は journal から再構成する。recovery が終わるまで全 host reader / build は 409 で停止し、mixed pair を成功した snapshot として扱わない。stale lease の除去は生存 process がないことを確認する既存運用を維持する。

これは協調 reader / writer に対する原子的な可視性と crash recovery であり、POSIX の二ファイル同時 rename ではない。外部エディタの変更は保存直前の hash と保存後の再検証で検出するが、lease に参加しない process による同時書き込みを完全には直列化できない。GUI の commit 中に外部エディタも保存する操作は保証外とし、検出時は journal と外部 bytes を保持して復旧を要求する。自動 merge、任意の外部内容の rollback、成功したと偽る処理はしない。この保証範囲を ADR-0013 / Architecture の atomic save 説明へ同期する。

receipt と異常 transaction は自動期限切れにしない。正常 transaction の before / after bytes は receipt の耐久化後に削除できる。receipt の明示 cleanup 時に、それ以前の commandId は再送不可として扱うための epoch を更新する。初期 host は cleanup を実装せず、receipt を保持する。

## 4. Browser capture profile

### 入力と資産

入力は frozen lock と抽出 renderer、canonical Props / texts / binding IDs、明示 State、logical size、pixel target、固定 environment。render は physical position / host Transform を受け取らない。React / react-dom / JSX runtime を含めて bundle に閉じ、残った external import は拒否する。bundler の `process.env.NODE_ENV` は production に固定し、CJS の静的 require も locked resolver だけを通す。Node で user module、package lifecycle script、project bundler config を実行しない。package metadata の解決は静的 subset に限定し、bare specifier の browser mapping、`imports` wildcard、target を持たない wildcard export は明示的に拒否する。

初期実依存 fixture は repo の pnpm lock で固定した `@base-ui/react` の Button と通常 CSS とする。utility CSS / preprocessor 設定の自動実行は含めない。CSS `url()` / `@import` は固定 asset map に解決し、未解決 URL を拒否する。画像 asset は PNG / JPEG / static WebP、font は TTF / OTF に限定し、signature と mediaType、decode 上限を検証する。外部 SVG、animated image、woff / woff2 はこの profile では拒否する。

Browser の request は予約 origin `https://unframe.invalid/` の固定 asset map にだけ [route.fulfill](https://playwright.dev/docs/api/class-route#route-fulfill) で bytes を返す。実 DNS / HTTP へ転送しない。初期 document、JS、CSS、font、画像も同じ map に含め、page の service worker、worker、WebSocket、download、popup、外部 navigation を拒否する。route 制御だけを network isolation とせず、後述の OS namespace でも外部接続を遮断する。

### 描画完了と binding

各 State は新しい Browser context と React root で描画する。固定 environment を user script より先に設定し、SDK が [createRoot](https://react.dev/reference/react-dom/client/createRoot) と [flushSync](https://react.dev/reference/react-dom/flushSync) で mount を開始する。flushSync は DOM commit の境界として使い、非同期データ取得や font 完了の保証とは扱わない。

SDK は lock にある font を明示 load し、`document.fonts.ready` と全 image decode を待つ。font は TTF/OTF の既存検証を初期経路で再利用し、woff/woff2 は bundler が保持できても初期 capture では非対応にする。animation / transition は無効化し、video / audio / iframe / canvas / WebGL は初期 subset で拒否する。非同期データ、timer による内容変更、Suspense の未解決状態を必要とする Component は対象外。DOM による検出だけで任意コードの非同期利用を完全に判定できるとはしない。

mount / 資産待機後に別 animation frame で二回 capture し、binding 集合、textContent、geometry と decoded RGBA bytes の一致を確認する。色・背景・透明度・画像変更も画素比較の対象になる。不一致は deadline まで再試行し、安定しなければ失敗する。各 capture 前後にも binding fingerprint を検査し、途中変更を拒否する。合格した後側の RGBA を成果物候補にし、比較中の両 buffer も既存 peak budget に計上する。これは測定窓内の安定判定であり、任意プログラムが将来変化しないことの証明ではない。反復 build の一致も別の受け入れ条件にする。

完成 Tree の heading / paragraph / button につき一 binding を要求する。未宣言、重複、除外済み、欠落 binding を拒否する。有効 Interaction は finite で正の可視領域を持ち、viewport / clip を適用した geometry を同じ layout snapshot から得る。disabled button は意味に残せるが、有効 Hit Region を返さない。初期は回転・skew・perspective の CSS transform と複雑な clip-path の操作領域を非対応にし、bounding box だけで操作可能範囲を過大評価しない。

### 隔離と終了

Opaque 実行の最初の対応 host は Linux とする。A2 で toolchain に固定した [bubblewrap](https://github.com/containers/bubblewrap) を追加し、user / mount / PID / IPC / network namespace、`--unshare-ipc`、`--new-session`、`--die-with-parent` を使う。Chromium sandbox も有効なままにする。Browser worker へは pinned executable / runtime closure と worker / Browser snapshot を読み取り専用 mount し、private tmpfs と必要最小限の `/proc`・device を与える。capture input は後述の継承 pipe で渡す。home、project root、credentials、D-Bus / desktop socket、host network / IPC を渡さない。bubblewrap 自体に完成した保護 policy があるとは扱わず、この mount / IPC policy を実装・試験する。

host と worker は継承 pipe で通信し、Browser の任意 JS に host filesystem / API callback を公開しない。worker process group の lifecycle を host が所有する。初期 profile は一 State の mount〜capture 30 秒、build 全体 120 秒、正常 close の猶予 2 秒とする。これは初期の停止上限であり、性能目標ではない。cancel / deadline / worker crash では TERM、猶予後 KILL で子 process を回収する。

hard memory / process limit は `memory.max = 1 GiB`、`pids.max = 128` に設定した cgroup v2 で worker 全体へ適用する。host は起動前に cgroup を作成・設定し、trusted bootstrap だけを起動して所属を確認する。bootstrap は host の許可 barrier を待ち、所属確認後にだけ Chromium を起動する。descendant の所属も検証してから未信頼 bundle を渡す。所属・制限の設定失敗は child を回収して拒否し、制限前に user module を load しない。

既存 Compiler の texture / output / accounted peak budget は別に維持する。必要な user namespace / cgroup delegation がない host は `opaque-isolation-unavailable` で実行前に拒否し、弱い sandbox や sandbox 無効の Chromium へ fallback しない。A2 の Nix 環境 / CI はこの profile が使える専用実行条件を用意し、通常 unit test には権限を要求しない。起動 recipe と Chromium の両立、memory / pids 上限、timeout / cancel と子 process 回収は隔離 integration test で検証する。

worker とその依存、Chromium と付属ファイルは private directory へ snapshot し、regular file の全 bytes と pinned Nix runtime closure を実行環境 hash に含める。symlink / special file は拒否する。DOM の観測は user script と別の Chromium isolated world から行う。

capture 成功後は raw RGBA を既存 encoder と Core integrity へ渡す。入力不正、binding、font、timeout、cancel、資源上限、隔離 unavailable は区別した diagnostic を返し、成功済み `dist` を変更しない。

## 5. 実装で固定する失敗試験

- static field に描画関数・副作用 module を参照させても実行されず拒否される。未使用の契約 initializer も render bundle に含まれない。
- state 別 missing / duplicate binding、禁止 asset URL、font decode 失敗、表示更新の継続、無限 loop、メモリ超過、cancel を区別して終了する。
- journal の各 fsync / rename 前後で crash させ、協調 reader に mixed Source / lock を返さない。外部編集を検出した recovery は bytes を上書きしない。
- command の応答喪失と同一 ID 再送、異なる body 再送、古い ETag、host restart、build 後の新 revision を扱う。
- Browser が Source、秘密情報、host network / IPC / local Editor token にアクセスできない。隔離 capability 欠落は capture 前に失敗する。cgroup barrier 前に user code が動かず、全 descendant に制限が及ぶことを確認する。

これらは A1〜A5 の実装試験であり、文書化や型試作の成功だけでは合格扱いにしない。
