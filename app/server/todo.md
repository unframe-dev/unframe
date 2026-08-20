# Backend TODO

この文書は、Control Plane と Realtime Backend をまたぐ現在の不整合と、各
`ARCHITECTURE.md` を実装へ同期するための作業を管理する。

Realtime Runtime 内部の機能ロードマップは
[`realtime/todo.md`](./realtime/todo.md) を正本とし、Cloud Agent、Snapshot /
Replay、Unity client、Fly.io deployment 等の項目をここへ重複させない。

## P1: Correctness と security boundary

### Completion callback で Runtime assignment を解放する

Realtime の completion callback は completion record の保存と durable Session の
`Ended` 遷移を行うが、`session_edge_assignments.released_at` を更新しない。通常の
Session end は assignment を解放するため、終了経路によって Edge の再利用条件が
異なっている。

影響:

- completion callback で終了した Session の assignment が lease 満了まで残る
- 同じ Edge を別 Session へ割り当てられない期間が発生する
- durable Session と Runtime assignment の lifecycle が一致しない

参照:

- [`control-plane/src/modules/persistence-callback/repository.ts`](./control-plane/src/modules/persistence-callback/repository.ts)
- [`control-plane/src/modules/sessions/repository.ts`](./control-plane/src/modules/sessions/repository.ts)
- [`control-plane/src/modules/venue-edges/repository.ts`](./control-plane/src/modules/venue-edges/repository.ts)

- [ ] Completion 保存、Session の `Ended` 遷移、active assignment の release を同じ
      D1 batch で行う
- [ ] 初回と重複 callback のどちらでも assignment release が冪等になることを検証する
- [ ] lease 満了前でも、completion 後に同じ Edge を別 Session へ割り当てられることを
      repository test で検証する

### Runtime JWT の Current contract を文書へ反映する

現在の実装は Edge 固有の移行中 contract である。

- audience: `unframe-venue-edge`
- expiry: active assignment の lease expiry
- binding: participant、Session、role、Edge ID、assignment epoch、Presentation ID /
  revision、scope、protocol version
- scope: `realtime:connect`、`assets:read`

一方、Control Plane と親 Backend の Architecture には旧 `unframe-realtime`
audience、1週間 expiry、静的 endpoint を前提とする記述が残っている。将来の
`RuntimeAssignment` / `runtimeId` / `runtimeKind` と Runtime 共通 audience は未決定で
あり、現行 contract と同一視しない。

参照:

- [`control-plane/ARCHITECTURE.md`](./control-plane/ARCHITECTURE.md)
- [`control-plane/src/modules/realtime-bootstrap/credential.ts`](./control-plane/src/modules/realtime-bootstrap/credential.ts)
- [`realtime/internal/auth/jwt.go`](./realtime/internal/auth/jwt.go)
- [`realtime/ARCHITECTURE.md`](./realtime/ARCHITECTURE.md)

- [ ] Control Plane Architecture の audience、expiry、claim、scope を現行実装へ合わせる
- [ ] 親 Backend Architecture の bootstrap boundary と integration status を現行実装へ
      合わせる
- [ ] Edge 固有の Current contract と Runtime 共通化後の Target contract を明確に分ける
- [ ] Contract変更時は発行側、検証側、test、README、生成artifactを同時に更新する

### Session `Ended` を Realtime へ反映する境界を定義する

Control Plane は `Ended` Session のjoinとbootstrapを拒否する。現在のRealtime
processはlocal assignmentのlease / epochを検証するが、Control PlaneのSession状態を
同期しないため、発行済みJWTとleaseが有効な間の新規接続、既存接続、resumeを
`Ended`だけで拒否できない。

- [ ] 親 Backend Architecture の「終了後は即時拒否」をPartialまたはTargetとして明記する
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

### Venue Edge の Current / Target 分類を更新する

現行実装では、次はCurrentである。

- Control PlaneのEdge provisioning、credential rotation / revoke、registration
- 単一roomのassignment、lease renewal / release、epoch fencing
- assignment-bound bootstrap endpoint、certificate fingerprint、JWT
- RealtimeのJWKS / scope検証と、接続・command・reliable deliveryのassignment fencing

次は引き続きPartialまたはTargetである。

- Control Planeからassignment / Manifestを同期するCloud Agent
- local HTTPS listener、証明書管理、Asset Gatewayのruntime composition
- `RuntimeAssignment` / `runtimeId` / `runtimeKind`への一般化
- Cloud Runtime、Unity consumer、checkpoint / completion sender、component間E2E

- [ ] [`ARCHITECTURE.md`](./ARCHITECTURE.md) のbootstrap、persistence、status、open
      decisionsを更新する
- [ ] [`control-plane/ARCHITECTURE.md`](./control-plane/ARCHITECTURE.md) のresponsibility、API
      ownership、service identity、Session、D1、directory、status、open decisionsを更新する
- [ ] Realtime Architectureの実装状況表をCurrent判定の正本として相互参照する

### `REALTIME_ENDPOINT` の扱いを決定する

`REALTIME_ENDPOINT` はControl Planeのruntime configで必須だが、Session bootstrapは
active Venue Edge assignmentの`localEndpoint`を返し、静的値を使用しない。

- [ ] 廃止するか、Cloud Runtime / fallback用として残すかを決定する
- [ ] 廃止する場合はconfig、Wrangler vars、binding型、test、READMEから削除する
- [ ] 残す場合は選択条件、authority、failure behaviorをArchitectureとroute contractへ定義する
- [ ] assignmentが存在しない場合に暗黙のfallbackを追加しない

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
