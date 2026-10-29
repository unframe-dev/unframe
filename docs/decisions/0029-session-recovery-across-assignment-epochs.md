# ADR-0029: lease 失効後の同一 Session 復旧

## Status

Accepted

## Context

assignment lease が失効すると新しい epoch が必要になる。checkpoint を旧 epoch のまま復元することも、checkpoint の identity 検証を省くことも、旧 Runtime の状態・命令と新 Runtime を区別できなくする。

## Decision

- Control Plane は、Session に保存した最新 checkpoint の version・Reliable sequence・保存元 assignment と固定 publication を検証し、現在の有効 assignment に対して `checkpointSource` を発行する。不一致や破損を初期状態で代替しない。
- Realtime は、保存元 identity で checkpoint の hash・cut・snapshot を検証した後、新しい epoch に全 Run ID とその参照を付け替える。Session・publication・Definition / RenderBundle hash は変えず、新しい catalog と epoch でも検証する。同一 epoch での Runtime 変更は許可しない。
- 進行位置・変数・時計・再生位置・Step 開始履歴・Run allocator・Reliable sequence を保持する。停止していた実時間を進行に加算せず、復元後は `Paused / processRecovered` とし（既存の invariant violation による停止理由は維持する）、Presenter の再認証・入力同期・明示 Resume を必要とする。
- 復元結果を新しい fence と増加した checkpoint version で保存してから接続を受け付ける。旧 epoch の資格、Resume cursor、遅延 checkpoint / completion は受理しない。replay のメモリ上の記録は継承せず Snapshot で同期する。

- Cloud Host の heartbeat は、同じ Host / endpoint の直前の未終了 assignment が失効していれば、Session ID を維持して新しい epoch を予約する。終了・明示解放済み、別 Runtime へ移動済み、履歴が曖昧な場合は自動で取り戻さない。

## Consequences

同じ Session ID と参加コードを維持して、新しい assignment から最後に保存できた状態へ復旧できる。未保存の変更、終了済み Session、壊れた checkpoint、異なる publication は復旧対象にしない。旧 Runtime と同時に進行する live migration は扱わない。

## Adoption and Exceptions

保存元の偽装、異なる Session / publication、未来 epoch、古い callback、version 後退を拒否する境界テストを維持する。実 Control Plane と Runtime の E2E で lease 失効後の世代更新、状態継続、一時停止、旧資格拒否、明示 Resume を確認する。復旧条件の緩和は本 ADR と対応する契約・テストを更新してレビューする。
