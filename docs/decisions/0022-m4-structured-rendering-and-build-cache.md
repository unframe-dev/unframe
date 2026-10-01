# ADR-0022: Structured rendering と local build cache

## Status

Accepted

## Context

M4 は M3A の absolute Frame / Text を generic Structured graph へ拡張し、Renderer / Assets の再現性とキャッシュを接続する。Presentation v2 は Image、Shape、Stack / Grid の portable field を既に定義している。描画と Hit Region が別々の layout 規則を使うと、見える位置と操作位置がずれる。

## Decision

- 静的 Structured Primitive を Frame、literal Text、Image、Shape とする。Image は明示 PNG / JPEG Asset、Shape は rectangle / ellipse / line。Frame は absolute / Stack / Grid を持ち、子の placement kind は親の layout kind と一致させる。root は absolute Frame に限定する。Variable Text と Video / Model は Runtime / consumer 契約が揃うまで拒否する。
- Authoring の `layout` は自身の placement、Frame の `flow` は子の Stack / Grid を表す。省略した `flow` は absolute。既存 Token / Prop の解決後、Core の `resolveStructuredLayout(surface, stateId)` が State ごとの全 Node の logical rect を計算する。Compiler の paint bounds / Hit Region と Renderer はこの一つの結果を使う。
- Stack は child 順、gap、padding、margin と basis size を保持し、正の残余を grow 比で配分する。grow がない残余は justifyContent へ、cross axis は alignItems / alignSelf へ配分する。Grid は fixed track を引いた正の残余を fraction 比で配分し、明示 1-based cell / span と margin / alignment を使う。CSS の自動配置・intrinsic size・Browser の layout 推論を採用しない。
- Image bytes は checksum と media type を検証した明示入力だけを data URI として読み込む。host path / network / CSS を入力にしない。fit、RGBA tint、border を portable field から描画する。Shape の paint は自身の placement rect 内へ clip し、stroke も partition bounds 外へ出さない。Semantic Node は明示 binding を保持し、DOM から推測しない。
- Renderer discovery は host が明示注入する凍結済み registry 内で行う。重複 ID と未対応 Renderer API contract version は build 前に拒否する。現在の execution class は `baked-web` のみ。任意 npm module の自動探索・実行や明示 preference の暗黙 fallback は追加しない。implementation version / contract version / fingerprint と候補 capability を build cache identity に含める。
- Compiler は任意の `CompilerBuildCache` を受け取り、成功した成果物のみ保存する。key は project 全体、Compiler、Renderer registry / fingerprint、locale / timezone / color scheme / config、encode limits、PNG encoder と texture policy を閉じる。hit でも現在の Definition、metadata integrity、全 asset bytes の checksum を検証する。破損と cache I/O failure は再 build へ戻し、成功 build の可否を cache availability に依存させない。
- CLI は Linux の project-local `.unframe/cache/builds-v1/<key-digest>` に metadata と checksum 名の binary を保存する。entry は staging から rename して公開し、成功・失敗・cancel の staging を回収する。directory FD を保持して書き込み先を固定し、symlink を辿らない。既定で完成 entry 16件を保持し、古い entry を回収する。Release / Delivery に cache や Authoring JS を含めない。
- Assets の `resizeRgba` は明示 target のみを扱い、縮小は pixel footprint の面積平均、拡大は pixel-center linear interpolation とする。sRGB8 を linear light へ変換し、alpha を掛けた色を補間してから unassociate / sRGB8 丸めを行う。出力 alpha が0ならRGBも0にする。source / output のraw RGBA checksum と固定 `linear-srgb-associated-alpha-box-linear-v1` provenance を返し、PNG encoder v1 を変更しない。
- Texture は ADR-0012 の単一 2K capture、sRGB straight / opaque、PNG / RGBA32、`mipCount: 1` を維持する。mipmap、GPU / lossy compression、premultiplied の暗黙変換は追加しない。Font は宣言 Asset と fallback の glyph coverage を検証して Browser 内部で全 font bytes を使用する。font を Delivery へ subset 出力する consumer は現在なく、subset toolchain を仮実装しない。Video / Model adapter も必要 consumer 確定後とする。

## Consequences

通常の Authoring / compile 経路で static generic graph を利用でき、layout と Hit Region の authority が一致する。再 build は capture を再利用できるが、Browser / font fingerprint の取得と source validation は引き続き必要になる。cache は復旧可能な最適化であり、Linux 専用の filesystem adapter、entry 単位の容量管理、保存 I/O の費用を持つ。remote cache、asset 横断の永続 dedup、Runtime residency はこの決定に含めない。

## Adoption and Exceptions

Core layout / Compiler partition / Renderer fixture を同じ変更で検証する。固定 Browser の exact RGBA baseline、cache hit と入力・renderer・font・locale・config 変更時の miss、checksum 改ざん、失敗・cancel cleanup をテストする。新しい Primitive、layout、codec、Renderer contract version は Authoring contract と関連 ADR・conformance fixture を更新して追加する。
