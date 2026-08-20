# Backend TODO

この文書は、Control Plane と Realtime Backend をまたぐ現在の不整合と、各
`ARCHITECTURE.md` を実装へ同期するための作業を管理する。

Realtime Runtime 内部の機能ロードマップは
[`realtime/todo.md`](./realtime/todo.md) を正本とし、Cloud Agent、Snapshot /
Replay、Unity client、Fly.io deployment 等の項目をここへ重複させない。

## P1: Correctness と security boundary

### Session `Ended` を Realtime へ反映する境界を定義する

Control Plane は `Ended` Session のjoinとbootstrapを拒否する。現在のRealtime
processはlocal assignmentのlease / epochを検証するが、Control PlaneのSession状態を
同期しないため、発行済みJWTとleaseが有効な間の新規接続、既存接続、resumeを
`Ended`だけで拒否できない。

- [ ] Cloud Agentまたは同等のcontrol channelでSession終了とassignment失効を伝える
      contractを定義する
- [ ] Realtime hot pathでmessageごとにControl Plane / D1へ問い合わせない
- [ ] 新規接続、既存接続、Connection Resume、Runtime Resumeそれぞれの停止規則を検証する

### Workers observability の privacy posture を一致させる

Control Plane README はOAuth codeとDevice Authorization user codeを保護するため
invocation logsとautomatic tracesを無効化したと記載しているが、`wrangler.toml`では
observability、invocation logs、tracesが有効である。

参照:

- [`control-plane/README.md`](./control-plane/README.md)
- [`control-plane/wrangler.toml`](./control-plane/wrangler.toml)

- [ ] URL、query、headerが収集される範囲とredaction可否を確認する
- [ ] logs / tracesを有効に保つか無効化するかをsecurity / operationsの判断として確定する
- [ ] `wrangler.toml`、README、実環境のeffective settingを一致させる
- [ ] OAuth code、Device user code、cookie、Bearer token、signed URLがtelemetryへ残らないことを
      stagingで検証する

## P2: Architecture と configuration の同期

### Runtime configuration validation の説明を修正する

Applicationの設定値検証はmodule evaluationやdeploy時ではなく、request boundaryと
scheduled handler boundaryで実行する。Wranglerのrequired secret名の確認、Worker
upload、applicationによる値検証を別の段階として扱う。

- [ ] [`control-plane/README.md`](./control-plane/README.md) の「deploy時に全設定を検証」
      という記述を実装へ合わせる
- [ ] deploy dry-run、remote secret presence、request-time value validationの結果を混同しない

### 上位のrepository statusを更新する

Repository rootのREADMEとArchitectureには、Control Planeの認証、認可、resource APIと
Realtime Backend全体を未実装とする古い記述が残っている。

- [ ] [`../../README.md`](../../README.md) の現在のステータスをcomponentごとのCurrent /
      Partialへ更新する
- [ ] [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) のbackend移行checklistを実装状況へ
      合わせる

## Completion criteria

- [ ] 実装、三階層のArchitecture、README、TODOのCurrent / Partial / Targetが一致する
- [ ] OpenAPI / TypeScript client、Protocol Buffers / Go生成物のdrift checkが通る
- [ ] Control PlaneとRealtimeのcomponent gateが通る
- [ ] component間E2Eが存在しない間は、component testをend-to-end成功として報告しない
- [ ] `git diff --check`とlocal Markdown link checkが通る
