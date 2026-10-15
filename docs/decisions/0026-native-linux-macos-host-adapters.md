# ADR-0026: Linux / macOS の native host を共通契約で扱う

## Status

Accepted

## Context

Local Editor、Opaque capture、PostCSS worker、build cache は Linux の process / filesystem primitive に依存していた。macOS Apple Silicon を VM なしで利用するため、入力と成果物の契約を保ち、OS 固有の実行機構を分離する。

## Decision

- 対象を Linux x86_64 と macOS arm64 とする。Windows、Intel Mac、VM 経由の実行は対象外とする。
- 入力 snapshot、POSIX 論理 path、検証、worker protocol、診断、成功時だけの atomic publication は共通にする。worker の隔離・監視・回収、cache の FD 相対操作、Editor 起動は native adapter が担う。
- 同じ実行環境内で成果物の再現性を検証する。OS 間の PNG bytes 一致は要求しない。OS / CPU、OS release、Node executable、固定 Browser、font bytes、Nix closure、隔離 profile の識別を environment / renderer fingerprint と cache identity に含める。
- PostCSS / Tailwind の style lock は単一の native runtime / dependency snapshot を保持する。OS を切り替える場合の明示的な `lock update` を許容する。`lock refresh` は runtime を切り替えず、通常の check / build も不一致時に暗黙更新しない。
- Linux の隔離は bubblewrap、Chromium sandbox、delegated cgroup v2 を維持する。worker 全体に `memory.max = 1 GiB` と `pids.max = 128` を適用し、barrier 前に所属を確認する。終了時は `cgroup.kill` と空確認を行う。
- macOS の隔離は Seatbelt の default-deny profile と Chromium sandbox を使う。許可 runtime / worker / Browser snapshot に加え、OS runtime の `/System/Library`・`/usr/lib`、必要な device の読み取りと `sysctl-read`、二つの Mach service lookup を許可する。書き込みは private scratch と `/dev/null` に限定し、worker 実行前に filesystem / network deny probe を行う。policy 不成立や回収失敗では成果物を受け付けない。
- macOS の資源制限は process group の RSS / process 数の監視と deadline による停止とする。cgroup と同じ hard subtree limit ではない。監視間隔内の一時的な超過と、group を離れた process の計測・回収は保証しない。この保証差を profile identity と文書に明示する。
- cache は Linux の `/proc/self/fd` backend と macOS の trusted Python dirfd backend に分ける。macOS も `openat` / `renameat` 相当と `O_NOFOLLOW` を使い、単なる文字列 path への fallback は設けない。helper の executable は host の固定環境から選び、lock や cache 内容に選ばせない。
- APFS の名前同一性は実 filesystem の inode と排他的作成で検証し、snapshot materialization で名前の alias による上書きを拒否する。任意の symlink を許可するために入力規則を緩めない。

## Consequences

Linux 固有の primitive を共通 API の必須条件にせず、各 OS が同じ入力・検証・公開規則を利用できる。描画環境が異なる cache entry は共有されない。

macOS の `sandbox-exec` は非推奨であり、OS 更新ごとに native integration を維持する必要がある。macOS の resource monitoring は Linux の強制上限より保証が弱い。Python helper と OS 別の隔離試験も保守対象になる。

## Adoption and Exceptions

Presentation CI は Linux と macOS arm64 の native runner を使い、同じ入力の再 build hash、wire の自己整合、filesystem / network 拒否、deadline / cancel と回収を検証する。共有 wire fixture の codec 検証を、OS 固有の描画 hash との比較に用いない。

macOS adapter は実装しているが、現在の開発 host では実機検証できていない。macOS runner 上で native integration が成功するまで、macOS 動作確認済みとは扱わない。隔離 capability が欠ける場合は実行前に拒否し、sandbox 無効化による代替経路は設けない。

ADR-0013 の Windows 未対応、入力 symlink 拒否と atomic publication の規則は維持する。ADR-0019 の Linux 限定範囲と ADR-0022 の Linux 専用 cache は本 ADR の adapter 境界で拡張する。
