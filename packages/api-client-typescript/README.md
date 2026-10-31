# Control Plane TypeScript Client

Control Plane の型付き `OpenAPIHono` application から公開した `AppType` を `hono/client` に適用する Hono RPC client です。入力、path parameter、status 別 response は実行ルートと同じ Zod / OpenAPI 定義から推論されます。

```ts
import { createControlPlaneClient } from "@unframe/api-client-typescript";

const client = createControlPlaneClient({
  baseUrl: "https://api.un-fra.me",
  credentials: "include",
});
const response = await client.presentations.$get();
if (response.ok) {
  const { presentations } = await response.json();
}
```

認証情報の保存は行いません。Web の cookie session では `credentials: "include"` を指定します。Unity の Bearer session は consumer が安全に保存し、各 request の `Authorization` header に設定します。

## Dist の公開

`@unframe/api-client-typescript/publication` の `createPublicationClient` は CLI と Console が共有する公開処理です。Cookie の `credentials: "include"` または `bearerToken` の一方を指定し、Console は `getTarget`、CLI は `readFence` で現在の公開版を取得し、取得した fence を `expectedPublicationFence` として `publish` に渡します。素材の検証・固定後にビルド登録、素材送信、公開確定を行い、公開応答の整合性も検証します。

公開確定要求の結果が不明な場合は `outcome: "unknown"` を返します。クライアントは自動再送せず、呼出側が現在の公開情報と照合します。

## Better Auth client

認証は Control Plane OpenAPI とは別の、Better Auth `1.7.1` に固定したバージョン付き契約境界です。Google / email-password sign-in、email verification、password reset、session、device authorization、TOTP / backup code MFA を型付きで利用できます。

```ts
import { createControlPlaneAuthClient } from "@unframe/api-client-typescript";

let bearerToken: string | undefined;
const auth = createControlPlaneAuthClient({
  baseUrl: "https://api.un-fra.me",
  credentials: "include",
  onAuthToken: (token) => {
    bearerToken = token;
  },
});

await auth.signIn.social({ provider: "google" });
const session = await auth.getSession();

const password = await auth.signIn.email({ email: "user@example.com", password: "password" });
if (password.data?.twoFactorRedirect) {
  await auth.twoFactor.verifyTotp({ code: "123456", trustDevice: true });
}
```

`onAuthToken` はBearer pluginがresponse headerへ出したcredentialを受け取ります。client自体はcredentialを保存しないため、consumerがplatformの安全な保存領域を使用します。

Device Authorizationのtoken endpointではresponse dataからcredentialを取得します。

```ts
const device = await auth.device.code({ client_id: "unframe-unity" });
const result = await auth.device.token({
  grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  client_id: "unframe-unity",
  device_code: device.data!.device_code,
});
const deviceBearerToken = result.data?.access_token;
```

このpackageはTypeScript consumer向けです。Unity / C# clientは別途接続します。

```ts
const verification = await auth.verifyDeviceAuthorization("ABCD-EFGH");
if (verification.data?.status === "pending") {
  await auth.device.approve({ userCode: verification.data.user_code });
}
```

`verifyDeviceAuthorization` は Better Auth の動的 client の代わりに、`GET /api/auth/device?user_code=` を明示的に呼び出します。custom fetch と `credentials` の設定を引き継ぎ、成功と API error を判別可能な型で返します。
