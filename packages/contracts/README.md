# Contracts

`proto/unframe/realtime/v1/realtime.proto` は Realtime gRPC protocol の source of truth です。Go generated code は `app/server/realtime/internal/gen/realtime/v1/` に出力します。generated files は手で編集しません。

repository root の Nix development shell で次を実行します。

```sh
scripts/contracts/generate-proto.sh
scripts/contracts/generate-proto.sh check
```

`nix run .#realtime` は生成物の drift check を含みます。C# client generation はまだ導入していません。
