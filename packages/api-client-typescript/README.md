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

## Better Auth client

認証は Control Plane OpenAPI とは別の、Better Auth `1.6.26` に固定したバージョン付き契約境界です。Google sign-in、session、device authorization を型付きで利用できます。

```ts
import { createControlPlaneAuthClient } from "@unframe/api-client-typescript";

const auth = createControlPlaneAuthClient({
  baseUrl: "https://api.un-fra.me",
  credentials: "include",
});

await auth.signIn.social({ provider: "google" });
const session = await auth.getSession();
const device = await auth.device.code({ client_id: "unframe-unity" });
const token = await auth.device.token({
  grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  client_id: "unframe-unity",
  device_code: device.data!.device_code,
});

const verification = await auth.verifyDeviceAuthorization("ABCD-EFGH");
if (verification.data?.status === "pending") {
  await auth.device.approve({ userCode: verification.data.user_code });
}
```

`verifyDeviceAuthorization` は Better Auth の動的 client の代わりに、`GET /api/auth/device?user_code=` を明示的に呼び出します。custom fetch と `credentials` の設定を引き継ぎ、成功と API error を判別可能な型で返します。
