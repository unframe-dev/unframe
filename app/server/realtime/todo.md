# Realtime Runtime follow-up

現在の Runtime は v2 Control / State だけを公開し、JWT の protocol version 2 を要求する。publication-pinned Definition / RenderBundle、participant projection、Snapshot / replay、Tracking、Cue / Action / Timeline、checkpoint / completion は接続済み。v1 wire、ページ番号直接操作、旧 Manifest は廃止した。

## 残る作業

- [ ] Cloud Machine と Venue Edge Agent の登録・起動・停止 lifecycle、assignment renew / release、graceful drain を接続する。
- [ ] 全 message 種別に共通する rate / invalid-message count policy を確定する。
- [ ] `pauseTimeout` の期間と自動終了 policy を確定する。
- [ ] Venue Edge の v2 Delivery access binding に基づく Asset cache、local HTTPS listener、証明書管理を実装する。
- [ ] observability exporter、trace、dashboard、alert を接続する。
- [ ] Fly.io の app / region / Machine / autoscaling / identity / health routing と deploy / rollback 手順を確定する。

## 実運用での検証

- [ ] Docker image の non-root 起動と公開 endpoint の TLS / HTTP2 を検証する。
- [ ] Quest 実機の Control / State 接続、Asset 表示、Tracking、reconnect を検証する。
- [ ] 1 / 10 / 25 / 50 Quest で latency、jitter、fan-out、Asset readiness を測定する。
- [ ] remote 配置で lease expiry、slow viewer、process restart、再配置、rolling update を検証する。

通常 process は単一 Session の assignment を環境変数から読み取る。ローカルの Go テストや既存の TLS smoke evidence は、remote 配備や Quest 実機での検証を意味しない。
