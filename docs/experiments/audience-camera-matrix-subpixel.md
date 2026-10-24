# 検出画像・カメラ行列・サブピクセルの確認

> 履歴（2026-10-22）：現在の実装は[AprilTag採用方式](./audience-apriltag-adopted.md)のみ。以下は当時の方式・スキーマ・実証の記録であり、削除済みの比較モードやコマンドを現行仕様として使用しない。

2026-10-21。SDK内部Binaryの解析は行わず、公開API・MIT公開描画アダプターと固定コミットのAprilTag公開ソースを確認した。

## 変更した取得契約

旧実装は表示canvasの比率に中央切抜きし、既定長辺960pxへ縮小していた。現在は同じ`realityTexture`をSDK報告video寸法全体でreadbackする。Workerでの再縮小もない。SDKの取得条件自体は変更しておらず、video寸法が768×1024なら検出も768×1024となる。realityTexture実寸・センサー原寸を確認したという意味ではない。

処理予算は4096×4096画素。超過時には明示エラーにし、自動縮小や別のカメラ取得へ切り替えない。120msの取得間隔・Workerのbackpressure・500msの観測齢制限は維持する。原寸化による処理時間増加・古い結果の棄却は新ログで確認する。

## 内部パラメータと推定関数

[XRController公開API](https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule)の`reality.intrinsics`は表示カメラ画角の列優先4×4投影行列である。[公開Three.js renderer](https://github.com/8thwall/8thwall/blob/main/reality/app/xr/js/src/threejs-renderer.ts)では同じ行列をThree.js cameraへ設定し、背景をvideo→canvasのcover viewportで描画する。[公開GL renderer](https://github.com/8thwall/8thwall/blob/main/reality/app/xr/js/src/gl-renderer.ts)の中央切抜きとviewport計算に基づき、全画像のKを以下で復元する。

1. canvas寸法`Wc,Hc`で`fxc=P[0]Wc/2`, `fyc=P[5]Hc/2`, `cxc=(1-P[8])Wc/2`, `cyc=(1+P[9])Hc/2`。
2. video→canvasのcover倍率`s`、オフセット`ox,oy`を求める。
3. 検出画像のKを`fx=fxc/s`, `fy=fyc/s`, `cx=(cxc-ox)/s`, `cy=(cyc-oy)/s`とする。

`frame.intrinsics`がtagの`estimateMarkerPose`およびanchorの`estimateBoardPose`へ渡る。共通ソルバーは異なるfx/fyと中心外の主点を扱い、再投影の最適化も同じKを使う。AprilTag wrapper内の固定Kによる姿勢出力は`return_pose=0`で無効であり、距離・方向の計算には使わない。

anchorの検出枠は全画像の角を`normalizedVideoToDisplay`で表示用coverへ変換する。tagは検出に使った全画像そのものへ描画する。画素だけ原寸化して、従来の表示座標用Kや角の表示方法を流用しない。

anchorの検出枠は非同期処理の完了時点では過去の撮影画像に対応しており、端末移動中の最新ライブ背景との遅延差は残る。

これは公開アダプターと数学モデルに整合する修正である。実機のBinaryが返す映像との一致、露光と姿勢の同期、歪み補正・物理較正値は未確認である。

## サブピクセル処理

[固定ARENA wrapper](https://github.com/arenaxr/apriltag-js-standalone/blob/f0fe55676265a1251ad36f18bac9939206a59e19/src/apriltag_js.c)で引数順を確認した。現設定`configure(1,0,1,1,0,0,0)`は内部間引きなし・辺補正有効・WASM姿勢出力無効である。[固定AprilTag core](https://github.com/WiseLabCMU/apriltag/blob/4cdba6a8c6cf4efeb032fa5542da927d4677c035/apriltag.c)でもdecimate=1で辺補正が実行される。今回AprilTagの補正を新規有効化したわけではない。角はJSONで小数2桁に丸められ、転送の刻みは0.01px。実際の計測精度を表す値ではない。角ごとの補正成功は公開wrapperが返さず、ログでは`upstream-unreported`とする。

ArUcoには勾配の局所最小二乗反復を追加した。OpenCVのcornerSubPixを呼ぶ実装ではない。最大2px移動、20反復、収束0.001px、窓半径最大4pxである。内部コードへの窓混入を抑えるため短辺30px未満は支持不足として補正しない。境界・勾配不足・過大変位・非収束・不正quadでは元角を保持し、理由を記録する。合成の平行移動・ぼけ・回転で整数丸めより角誤差が改善することを検査し、実ArUco検出への結合も確認した。実機精度への効果は未計測である。

## ログと次の実機確認

両モードのログをschemaVersion 8へ更新した。`captureMetadata`に原寸出力、変換済K、元投影、表示viewport・正規化表示変換を保存する。検出結果は補正方式・各角の状態・変位量を持つ。画像は保存しない。

同じ端末・同じタグの実寸・同じ照明で、実測斜距離1m/3m/7mと正面/斜めを記録する。検出率だけでなく、入力寸法、K、最小辺画素数、補正状態、距離差、向き、処理時間、観測齢と棄却数を比較する。7mで短辺が数十px未満なら、サブピクセル処理だけで情報不足を解消できるとは扱わない。

5枚全体50×70cmのボードによる推定・連続補正・不可視5〜10分保持は引き続き設計対象であり、この変更では実装・実証していない。

## 検証結果

TDDで旧実装の失敗を確認して修正。原寸取得、4K入力の予算、超過拒否、canvas縦横・リサイズに依存しない復元K、異方焦点距離・中心外主点、7mの合成角→実PnP、表示角変換、補正成否、ログ出力を検証する。合成データの成功は実機精度の達成とは区別する。品質ゲートの実行結果は実行後に追記する。

Audience専用ゲート`nix run .#audience`は型検査・lint・192テスト・本番ビルドが成功した。schema8のfixture寸法整合後のログ出力4テストも成功した。公開HTTPSのHTMLおよびentry JavaScriptをHTTP取得し、ローカルビルドとのSHA-256一致を確認した。ブラウザ操作はWork設定で利用できず、変更後のGPU統合ラボ・実カメラ試験は未実施である。

`nix run .#check`は終了コード1。Control Planeと先行する共通パッケージを通過後、未変更の`packages/unframe-cli/test/react-project.test.ts:323`で`semantic/cli-lock-update-failed: The encoded data was not valid for encoding utf-8`が発生した。CLIは420成功・1失敗。前回の全体チェックでも同じUTF-8エラーが記録されている。全体ゲートは成功扱いにせず、後続のRealtime等はこの実行では到達していない。Audienceは別途専用ゲートで検証済み。全体ログは`/tmp/audience-matrix-subpixel-full-check.log`、専用ログは`/tmp/audience-matrix-subpixel-check.log`。

品質処理後の`git status`・`git diff`・ステージ済差分を確認し、今回対象外の追加変更がないことを確認した。コミット・pushはしていない。

## 2026-10-21 単一タグの暫定サイズ変更

ユーザー確認により黒い検出境界を15×15cm、白い余白込み外寸を22.5×22.5cmとした。tagの既定プロファイルは`size=22.5`で、UI・印刷SVG・姿勢推定の実寸を同時に変更した。queryのsizeは引き続き余白込み外寸を意味する。50/60/70cmの試験プロファイルとanchorのボード寸法は変更していない。単一タグの195テスト・型検査・lint・ビルドが成功した。生成された225mm外寸と黒境界150mm、既定プロファイルの推定距離、印刷リンクの対応を検証した。
