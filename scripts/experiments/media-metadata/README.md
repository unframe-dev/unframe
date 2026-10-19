# 動画 metadata spike

`ffprobe` の codec 情報による判別と、全 decode が必要な検証の境界を測る独立実験。本番の動画 validator は実装しない。

```sh
scripts/experiments/media-metadata/run.sh
```

Node.js と `libx264` 有効の FFmpeg／ffprobe **8.1.2** が PATH 上に必要。今回は既存ホスト環境の 8.1.2 で実行した。repository flake に FFmpeg は追加・固定していない。version 文字列は検査するが、ビルド設定や依存ライブラリまで固定するものではない。未導入の場合はホストへ install せず一時的な `nix shell nixpkgs#ffmpeg -c scripts/experiments/media-metadata/run.sh` を使えるが、floating nixpkgs から8.1.2が得られる保証はなく、異なる版では停止する。

生成する13個の小さな合成 MP4 と probe/decode の生出力は `.unframe/media-metadata-spike/` に置く。版の詳細は `ffmpeg-version.txt` と `ffprobe-version.txt`、判別結果は `results.json`、要約は `compact-results.json`。fixture の binary は追跡しない。今回の要約は [results-linux.json](results-linux.json) に保存した。

## 実測（2026-10-19、Linux x86_64）

全 assertion が成功し、`run.sh` は exit 0。

| fixture                               | 観測                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常・音声なし                        | H.264 High、level 41、yuv420p、8bit、progressive、動画1本                                                                                      |
| 正常・音声あり                        | 上記に AAC-LC、48kHz、stereo が1本                                                                                                             |
| 10bit                                 | High 10、yuv420p10le、bits_per_raw_sample=10                                                                                                   |
| 4:2:2                                 | High 4:2:2、yuv422p                                                                                                                            |
| interlace                             | field_order=tt（正常素材は progressive）                                                                                                       |
| 44.1kHz                               | AAC-LC、sample_rate=44100                                                                                                                      |
| 複数 video track                      | video stream が2本                                                                                                                             |
| 偽の説明 tags                         | title に Main/level 1/duration 9999 を記録しても codec 情報は High/41、duration 1秒。profile 等の metadata 指定も codec 情報を上書きしなかった |
| moov 不在・不正 bytes                 | 通常 probe、全 decode とも失敗                                                                                                                 |
| faststart の mdat を10,000bytesで切断 | 通常 probe は exit 0・duration 1秒。`ffmpeg -xerror -err_detect explode -i … -map 0 -f null -` は corrupt input packet で exit 183             |
| timestamp を50倍に拡大                | decode されるフレームは5個、PTS は0/10/20/30/40秒、container duration は40.2秒                                                                 |

timestamp 素材の decoded frame duration は10/10/10/0.2/10秒で、最大 `PTS + frame duration` は50秒だった。container duration とも一致しないため、この実験から単一の「正しい duration」を自動採用しない。duration 判定には timestamp、最終 sample duration、container/stream 値の整合規則が必要で、`nb_frames / 元のfps` だけでは判定できない。

## 検証責務

codec 名と拡張子だけでなく profile/level、pixel format、bit depth、field order、音声条件、track 数を調べる候補として `ffprobe` は利用できる。今回の tag 実験は SPS・sample table の全偽装耐性を証明しない。全フレームの途中変化、未知の container 構造、契約上の上限を網羅する production validator も未実装。

通常 probe の成功は payload 完全性や decode 成功を保証しない。全 decode の成否と仕様条件の合否は別に扱う必要がある。また FFmpeg で decode 可能でも Unity/WebGL/Quest の decoder 対応は証明できない。

この script は既知の小さな合成入力専用。inspect 側の子プロセスには10秒 timeout／stdout・stderr 各1MiB上限を設けたが、生成処理や任意入力の CPU・memory・process 数を隔離しない。本番での入力bytes、寸法、フレーム数、実行時間、出力、取消、外部参照・network 制限は、既存 worker host と素材 validator の責務として別途実装する。tool の固定と provenance/cache identity、Linux/macOSそれぞれの検証も残る。

コマンドの出力・選択項目は [FFprobe公式資料](https://ffmpeg.org/ffprobe.html) を参照。ここでの判別結果は同梱 script の生成 fixture に対する実測である。
