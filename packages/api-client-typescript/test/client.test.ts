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
  schemaVersion: 1,
  metadata: { title: "Demo" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [10, 3, 10],
    zones: [],
  },
  assets: [],
  groups: [
    {
      id: "group-1",
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
      anchoredElementGroups: [],
      steps: [
        {
          id: "step-1",
          cues: [
            {
              id: "cue-1",
              trigger: { kind: "button", action: "next" },
              actions: [{ kind: "setVisible", targetElementId: "text-1", visible: true }],
              next: { kind: "end" },
            },
          ],
        },
      ],
    },
  ],
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
          JSON.stringify({ id: "presentation-1", revision: 1, definition: presentation }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ asset: { id: "asset-1" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createControlPlaneClient({
      baseUrl: "https://control-plane.example",
      fetch,
      credentials: "include",
    });

    const createdPresentation = await client.presentations.$post({ json: presentation });
    const initializedUpload = await client.assets.uploads.$post({
      json: {
        presentationId: "presentation-1",
        name: "image.png",
        mediaType: "image/png",
        sizeBytes: 42,
        sha256Hex: "a".repeat(64),
      },
    });

    const [presentationUrl, presentationInit] = fetch.mock.calls[0] ?? [];
    const [assetUrl, assetInit] = fetch.mock.calls[1] ?? [];
    if (!presentationInit || !assetInit) throw new Error("Expected request options");

    expect({
      url: presentationUrl,
      method: presentationInit.method,
      credentials: presentationInit.credentials,
      body: JSON.parse(String(presentationInit.body)),
      authorization: new Headers(presentationInit.headers).get("authorization"),
    }).toEqual({
      url: "https://control-plane.example/presentations",
      method: "POST",
      credentials: "include",
      body: presentation,
      authorization: null,
    });
    expect({
      url: assetUrl,
      method: assetInit.method,
      body: JSON.parse(String(assetInit.body)),
      authorization: new Headers(assetInit.headers).get("authorization"),
    }).toEqual({
      url: "https://control-plane.example/assets/uploads",
      method: "POST",
      body: {
        presentationId: "presentation-1",
        name: "image.png",
        mediaType: "image/png",
        sizeBytes: 42,
        sha256Hex: "a".repeat(64),
      },
      authorization: null,
    });

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
        status: 200,
        headers: { "content-type": "application/json", "set-auth-token": "bearer-token" },
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
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: "unframe-unity",
        device_code: "device-code",
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
      new Response(JSON.stringify({ user_code: "ABCD-EFGH", status: "pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const auth = createControlPlaneAuthClient({
      baseUrl: "https://control-plane.example",
      fetch,
      credentials: "include",
    });

    await expect(auth.verifyDeviceAuthorization("A+B C")).resolves.toEqual({
      data: { user_code: "ABCD-EFGH", status: "pending" },
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
        JSON.stringify({ error: "expired_token", error_description: "The user code has expired" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const auth = createControlPlaneAuthClient({ baseUrl: "https://control-plane.example", fetch });

    await expect(auth.verifyDeviceAuthorization("ABCD-EFGH")).resolves.toEqual({
      data: null,
      error: { error: "expired_token", error_description: "The user code has expired" },
    });
  });
});
