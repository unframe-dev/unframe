import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { InferRequestType, InferResponseType } from "hono/client";
import {
  authTokenFromResponse,
  type ControlPlaneClient,
  createControlPlaneAuthClient,
  createControlPlaneClient,
} from "../src";

type CreatePresentationRequest = InferRequestType<
  ControlPlaneClient["presentations"]["$post"]
>["json"];

type CreatePresentationResponse = InferResponseType<
  ControlPlaneClient["presentations"]["$post"],
  201
>;

type InitAssetUploadResponse = InferResponseType<
  ControlPlaneClient["assets"]["uploads"]["$post"],
  201
>;

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;

const presentation: CreatePresentationRequest = {
  assets: [],
  groups: [
    {
      anchoredElementGroups: [],
      elements: [
        {
          id: "text-1",
          type: "text",
          content: { text: "Demo" },
          initialState: {
            active: true,
            visible: true,
            opacity: 1,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          },
        },
      ],
      id: "group-1",
      steps: [
        {
          cues: [
            {
              id: "cue-1",
              trigger: { kind: "button", action: "next" },
              actions: [{ kind: "setVisible", targetElementId: "text-1", visible: true }],
              next: { kind: "end" },
            },
          ],
          id: "step-1",
        },
      ],
    },
  ],
  metadata: { title: "Demo" },
  schemaVersion: 1,
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [10, 3, 10],
    zones: [],
  },
};

describe("createControlPlaneClient", () => {
  it("exposes inferred Hono RPC request and response types", () => {
    type GetPresentationRequest = InferRequestType<
      ControlPlaneClient["presentations"][":id"]["$get"]
    >;

    type RequestIsTyped = AssertFalse<IsAny<CreatePresentationRequest>>;
    type ResponseIsTyped = AssertFalse<IsAny<CreatePresentationResponse>>;

    expectTypeOf<RequestIsTyped>().toEqualTypeOf<false>();
    expectTypeOf<ResponseIsTyped>().toEqualTypeOf<false>();
    expectTypeOf<CreatePresentationResponse["id"]>().toEqualTypeOf<string>();
    expectTypeOf<GetPresentationRequest>().toEqualTypeOf<{ param: { id: string } }>();
  });

  it("sends typed presentation and asset requests through the injected fetch", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ definition: presentation, id: "presentation-1", revision: 1 }),
          { headers: { "content-type": "application/json" }, status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ asset: { id: "asset-1" } }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      );
    const client = createControlPlaneClient({
      baseUrl: "https://control-plane.example",
      credentials: "include",
      fetch,
    });

    const createdPresentation = await client.presentations.$post({ json: presentation });
    const initializedUpload = await client.assets.uploads.$post({
      json: {
        mediaType: "image/png",
        name: "image.png",
        presentationId: "presentation-1",
        sha256Hex: "a".repeat(64),
        sizeBytes: 42,
      },
    });

    const [presentationUrl, presentationInit] = fetch.mock.calls[0] ?? [];
    const [assetUrl, assetInit] = fetch.mock.calls[1] ?? [];
    if (!presentationInit || !assetInit) {
      throw new Error("Expected request options");
    }

    expect({
      authorization: new Headers(presentationInit.headers).get("authorization"),
      body: JSON.parse(String(presentationInit.body)),
      credentials: presentationInit.credentials,
      method: presentationInit.method,
      url: presentationUrl,
    }).toEqual({
      authorization: null,
      body: presentation,
      credentials: "include",
      method: "POST",
      url: "https://control-plane.example/presentations",
    });
    expect({
      authorization: new Headers(assetInit.headers).get("authorization"),
      body: JSON.parse(String(assetInit.body)),
      method: assetInit.method,
      url: assetUrl,
    }).toEqual({
      authorization: null,
      body: {
        mediaType: "image/png",
        name: "image.png",
        presentationId: "presentation-1",
        sha256Hex: "a".repeat(64),
        sizeBytes: 42,
      },
      method: "POST",
      url: "https://control-plane.example/assets/uploads",
    });

    if (createdPresentation.status !== 201 || initializedUpload.status !== 201) {
      throw new Error("Expected successful create responses");
    }
    const typedPresentation: CreatePresentationResponse = await createdPresentation.json();
    const typedAsset: InitAssetUploadResponse = await initializedUpload.json();
    expect(typedPresentation.id).toBe("presentation-1");
    expect(typedAsset.asset.id).toBe("asset-1");
  });
});

describe("createControlPlaneAuthClient", () => {
  it("extracts the bearer credential from Better Auth responses", () => {
    expect(
      authTokenFromResponse(new Response(null, { headers: { "set-auth-token": "token" } })),
    ).toBe("token");
  });

  it("delivers bearer credentials emitted by auth actions", async () => {
    const onAuthToken = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: "session-token", user: { id: "user-1" } }), {
        headers: { "content-type": "application/json", "set-auth-token": "bearer-token" },
        status: 200,
      }),
    );
    const auth = createControlPlaneAuthClient({
      baseUrl: "https://control-plane.example",
      fetch,
      onAuthToken,
    });

    await auth.twoFactor.verifyTotp({ code: "123456" });

    expect(onAuthToken).toHaveBeenCalledWith("bearer-token");
  });

  it("exposes typed Google sign-in, session, device authorization, and two-factor actions", () => {
    const auth = createControlPlaneAuthClient({ baseUrl: "https://control-plane.example" });

    const typedActions = () => {
      const googleSignIn = auth.signIn.social({ provider: "google" });
      const session = auth.getSession();
      const deviceCode = auth.device.code({ client_id: "unframe-unity" });
      const deviceToken = auth.device.token({
        client_id: "unframe-unity",
        device_code: "device-code",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const verifyTotp = auth.twoFactor.verifyTotp({ code: "123456", trustDevice: true });
      const backupCode = auth.twoFactor.verifyBackupCode({
        code: "backup-code",
        trustDevice: true,
      });
      const approve = auth.device.approve({ userCode: "ABCD-EFGH" });
      const deny = auth.device.deny({ userCode: "ABCD-EFGH" });
      const verification = auth.verifyDeviceAuthorization("ABCD-EFGH");

      void googleSignIn;
      void session;
      void deviceCode;
      void deviceToken;
      void verifyTotp;
      void backupCode;
      void approve;
      void deny;
      void verification;
    };
    expect(typedActions).toBeTypeOf("function");
  });

  it("verifies a device code with the configured fetch and credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending", user_code: "ABCD-EFGH" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const auth = createControlPlaneAuthClient({
      baseUrl: "https://control-plane.example",
      credentials: "include",
      fetch,
    });

    await expect(auth.verifyDeviceAuthorization("A+B C")).resolves.toEqual({
      data: { status: "pending", user_code: "ABCD-EFGH" },
      error: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://control-plane.example/api/auth/device?user_code=A%2BB+C",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns the typed API error when device verification is rejected", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "expired_token",
          error_description: "The user code has expired",
        }),
        { headers: { "content-type": "application/json" }, status: 400 },
      ),
    );
    const auth = createControlPlaneAuthClient({ baseUrl: "https://control-plane.example", fetch });

    await expect(auth.verifyDeviceAuthorization("ABCD-EFGH")).resolves.toEqual({
      data: null,
      error: { error: "expired_token", error_description: "The user code has expired" },
    });
  });

  it.each([
    { body: "null", name: "null success", status: 200 },
    { body: "null", name: "null error", status: 400 },
    { body: "[]", name: "array success", status: 200 },
    { body: "[]", name: "array error", status: 400 },
    { body: '"unexpected"', name: "primitive success", status: 200 },
    { body: "42", name: "primitive error", status: 400 },
    { body: "not JSON", name: "non-JSON success", status: 200 },
    { body: "not JSON", name: "non-JSON error", status: 400 },
    {
      body: '{"user_code":"ABCD-EFGH","status":"unknown"}',
      name: "malformed success",
      status: 200,
    },
    { body: '{"error":42,"error_description":false}', name: "malformed error", status: 400 },
  ])("returns request_failed for $name device verification responses", async ({ body, status }) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status }));
    const auth = createControlPlaneAuthClient({ baseUrl: "https://control-plane.example", fetch });

    await expect(auth.verifyDeviceAuthorization("ABCD-EFGH")).resolves.toEqual({
      data: null,
      error: { error: "request_failed" },
    });
  });
});
