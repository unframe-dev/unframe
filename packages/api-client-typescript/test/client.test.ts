import { describe, expect, it, vi } from "vitest";
import type { paths } from "@unframe/contracts/control-plane";
import {
  authTokenFromResponse,
  createControlPlaneAuthClient,
  createControlPlaneClient,
} from "../src";

type CreatePresentationRequest = NonNullable<
  paths["/presentations"]["post"]["requestBody"]
>["content"]["application/json"];

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

    const createdPresentation = await client.POST("/presentations", { body: presentation });
    const initializedUpload = await client.POST("/assets/uploads", {
      body: {
        presentationId: "presentation-1",
        name: "image.png",
        mediaType: "image/png",
        sizeBytes: 42,
        sha256Hex: "a".repeat(64),
      },
    });

    const presentationRequest = fetch.mock.calls[0]?.[0];
    const assetRequest = fetch.mock.calls[1]?.[0];
    expect(presentationRequest).toBeInstanceOf(Request);
    expect(assetRequest).toBeInstanceOf(Request);
    if (!(presentationRequest instanceof Request) || !(assetRequest instanceof Request))
      throw new Error("Expected requests");

    expect({
      url: presentationRequest.url,
      method: presentationRequest.method,
      credentials: presentationRequest.credentials,
      body: await presentationRequest.json(),
      authorization: presentationRequest.headers.get("authorization"),
    }).toEqual({
      url: "https://control-plane.example/presentations",
      method: "POST",
      credentials: "include",
      body: presentation,
      authorization: null,
    });
    expect({
      url: assetRequest.url,
      method: assetRequest.method,
      body: await assetRequest.json(),
      authorization: assetRequest.headers.get("authorization"),
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

    if (!createdPresentation.data || !initializedUpload.data)
      throw new Error("Expected successful responses");
    const typedPresentation: paths["/presentations"]["post"]["responses"][201]["content"]["application/json"] =
      createdPresentation.data;
    const typedAsset: paths["/assets/uploads"]["post"]["responses"][201]["content"]["application/json"] =
      initializedUpload.data;
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

      void googleSignIn;
      void session;
      void deviceCode;
      void deviceToken;
      void verifyTotp;
      void backupCode;
    };
    expect(typedActions).toBeTypeOf("function");
  });
});
