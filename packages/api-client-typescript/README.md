# Control Plane TypeScript Client

`packages/contracts/openapi/control-plane.openapi.json` から生成した path 型を `openapi-fetch` へ適用する薄い client です。

```ts
import { createControlPlaneClient } from "@unframe/api-client-typescript";

const client = createControlPlaneClient({
  baseUrl: "https://api.un-fra.me",
  credentials: "include",
});
const result = await client.GET("/presentations");
```

認証情報の保存は行いません。Web の cookie session では `credentials: "include"` を指定します。Unity の Bearer session は consumer が安全に保存し、各 request の `Authorization` header に設定します。
