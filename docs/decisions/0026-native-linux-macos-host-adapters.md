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
- macOS の隔離は Seatbelt の default-deny profile と Chromium sandbox を使う。許可 runtime / worker / Browser snapshot に加え、OS runtime の `/System/Library`・`/usr/lib`、必要な device の読み取りと `sysctl-read`、二つの Mach service lookup を許可する。Node の初期化に必要な `/` 自体の読み取りと、許可パスの祖先ディレクトリの metadata 読み取りも許可する。祖先配下のデータ読み取りは許可しない。書き込みは private scratch と `/dev/null` に限定し、worker 実行前に filesystem / network deny probe を行う。policy 不成立や回収失敗では成果物を受け付けない。
- Chromium の起動は Nix に固定した署名済み native helper が仲介する。helper だけを Node の Seatbelt 継承から除外し、PID・開始時刻・実行ファイル・hash を private registry と照合する。引数・環境・継承 FD を限定して固定 headless shell を exec し、全 role に制限済み compiled profile の必須 FD を渡す。headless entry は本体処理の前に profile を適用し、不成立なら終了する。macOS 15 が sandbox の再適用を拒否するため、helper は browser 側へ先行適用しない。適用前の loader / bootstrap は隔離外の信頼済みコードに限定し、capture 入力は ready 確認後に渡す。Chromium 自体を継承除外にしない。
- renderer / GPU は固定 Chromium の元 profile と trusted parameters を照合してから、許可 filesystem / Mach / IOKit の範囲との交差を適用する。仲介で変わる自己 executable parameter は、照合時の helper から適用時の Chromium へ正規化する。元々 sandbox 未適用の NetworkService にも default-deny profile を適用する。child profile は helper の継承除外を持たず、network は許可しない。起動引数と継承 FD を限定し、未知の role / policy / 引数では起動を拒否する。
- macOS の資源制限は子孫 process と発見済み process group の RSS / process 数の監視、deadline による停止とする。Playwright が別 group で起動する Browser も追跡する。cgroup と同じ hard subtree limit ではなく、監視間隔内の一時的な超過、未観測の別 group へ移って reparent された process、PID / PGID 再利用や検査と signal の間の競合は保証対象外とする。この保証差を profile identity と文書に明示する。
- cache と Author の保存 transaction の低水準 I/O は Linux / macOS とも Go 製 filesystem helper が所有する。helper は directory handle と `os.Root` による相対操作、末尾 symlink の非追跡、完全書き込み、file / directory の同期、EOF 時の handle 解放を行う。異なる directory 間の rename は固定した両 FD を `golang.org/x/sys/unix.Renameat` に渡し、中間 path を再解決しない。TypeScript は schema、checksum、cache key、保持方針と transaction の状態を所有する。helper は `scripts/build-cli-filesystem.sh` で `packages/unframe-cli/.cache/filesystem-helper` に生成し、CLI は固定の生成先から起動する。lock や cache 内容に executable を選ばせない。
- APFS の名前同一性は実 filesystem の inode と排他的作成で検証し、snapshot materialization で名前の alias による上書きを拒否する。任意の symlink を許可するために入力規則を緩めない。

## Consequences

Linux 固有の primitive を共通 API の必須条件にせず、各 OS が同じ入力・検証・公開規則を利用できる。描画環境が異なる cache entry は共有されない。

macOS の `sandbox-exec` は非推奨であり、OS 更新ごとに native integration を維持する必要がある。macOS の resource monitoring は Linux の強制上限より保証が弱い。Go 製 filesystem helper、TypeScript 製 Chromium policy compiler、署名済み Chromium 起動 helper と OS 別の隔離試験も保守対象になる。Chromium / Playwright の更新では、固定 profile・parameter・起動引数の照合と native integration を更新する。

## Adoption and Exceptions

Presentation CI は Linux と macOS arm64 の native runner を使い、同じ入力の再 build hash、wire の自己整合、filesystem / network 拒否、deadline / cancel と回収を検証する。共有 wire fixture の codec 検証を、OS 固有の描画 hash との比較に用いない。

2026-10-18 の macOS 27.0.1 arm64 実機検証では、通常の Presentation check、参照 project の二回 build hash 一致、Unity WebGL Preview build、Local Editor から Unity native runtime への接続・描画 E2E が成功した。Opaque capture も native 隔離、画素の再現性、font、network 拒否、deadline / cancel と回収、CLI の編集・保存・再 build と失敗時の成果物保持が成功した。Linux 専用の隔離試験は macOS の検証対象に含めない。隔離 capability が欠ける場合は実行前に拒否し、sandbox 無効化による代替経路は設けない。

ADR-0013 の Windows 未対応、入力 symlink 拒否と atomic publication の規則は維持する。ADR-0019 の Linux 限定範囲と ADR-0022 の Linux 専用 cache は本 ADR の adapter 境界で拡張する。
