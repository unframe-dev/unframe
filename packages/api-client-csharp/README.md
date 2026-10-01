# C# generated consumers

`Generated/ControlPlane/` は Control Plane の OpenAPI 正本から OpenAPI Generator 7.22.0 が作る HTTP client と model、`Generated/Proto/` は Presentation / Delivery / Realtime v2 の `.proto` 正本から `protoc` 35.1 と Grpc.Tools 2.76.0 が作る message と gRPC service です。`Generated/provenance.sha256` に入力ハッシュと生成器バージョンを記録します。生成ファイルは編集せず、正本を更新して再生成します。

Nix 開発環境で次を実行します。

```bash
nix run .#v2-consumers -- generate
nix run .#v2-consumers -- check
scripts/contracts/generate-valid-delivery.sh generate
scripts/contracts/check-v2-breaking.sh check
dotnet build packages/api-client-csharp/Proto/Unframe.Wire.csproj
dotnet build packages/api-client-csharp/Generated/ControlPlane/Unframe.ControlPlane.csproj
dotnet run --project packages/api-client-csharp/Conformance/Unframe.Wire.Conformance.csproj -- packages/contracts/presentation/v2/fixtures/wire/conformance.json packages/contracts/presentation/v2/fixtures/wire/valid-delivery.json
```

`Unframe.Wire` と `Unframe.ControlPlane` は独立した assembly です。Unity は既存の `scripts/contracts/generate-unity-proto.sh` で message source を配置しており、この package の assembly を Unity に追加する接続はまだありません。共有 wire fixture は TypeScript、Go、C# の codec を検証します。`valid-delivery.json` は参照プロジェクトの Fixed Browser ビルドと Core の出版・Delivery 検証を通した実コンパイラ由来の Manifest です。`scripts/ci/presentation.sh` はその再生成差分も確認します。
