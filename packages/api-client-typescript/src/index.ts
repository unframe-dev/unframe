import type { AppType } from "@unframe/control-plane/rpc";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient, twoFactorClient } from "better-auth/client/plugins";
import { hc } from "hono/client";

export type ControlPlaneClient = ReturnType<typeof hc<AppType>>;

export type ControlPlaneClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
};

export const createControlPlaneClient = ({
  baseUrl,
  fetch,
  credentials,
}: ControlPlaneClientOptions): ControlPlaneClient =>
  hc<AppType>(baseUrl, {
    ...(fetch ? { fetch } : {}),
    ...(credentials ? { init: { credentials } } : {}),
  });

export type ControlPlaneAuthClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  onAuthToken?: (token: string) => void;
};

/** Extracts the Bearer credential emitted by Better Auth's bearer plugin. */
export const authTokenFromResponse = (response: Response): string | undefined =>
  response.headers.get("set-auth-token") ?? undefined;
export type DeviceAuthorizationVerification = {
  user_code: string;
  status: "pending" | "approved" | "denied";
};

export type DeviceAuthorizationVerificationError = {
  error: string;
  error_description?: string;
};

export type DeviceAuthorizationVerificationResult =
  | { data: DeviceAuthorizationVerification; error: null }
  | { data: null; error: DeviceAuthorizationVerificationError };

function createDeviceAuthorizationVerifier({
  baseUrl,
  fetch: customFetch,
  credentials,
}: ControlPlaneAuthClientOptions) {
  const request = customFetch ?? globalThis.fetch;

  return async (userCode: string): Promise<DeviceAuthorizationVerificationResult> => {
    const url = new URL("api/auth/device", `${baseUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("user_code", userCode);
    const response = await request(url.toString(), {
      method: "GET",
      ...(credentials ? { credentials } : {}),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Better Auth errors may not have a JSON response body.
    }

    if (
      response.ok &&
      typeof body["user_code"] === "string" &&
      (body["status"] === "pending" ||
        body["status"] === "approved" ||
        body["status"] === "denied")
    ) {
      return { data: { user_code: body["user_code"], status: body["status"] }, error: null };
    }

    return {
      data: null,
      error: {
        error: typeof body["error"] === "string" ? body["error"] : "request_failed",
        ...(typeof body["error_description"] === "string"
          ? { error_description: body["error_description"] }
          : {}),
      },
    };
  };
}

/**
 * Better Auth v1 client contract for browser authentication, MFA, and device authorization.
 * This is versioned independently because Better Auth endpoints are not part of
 * the Control Plane OpenAPI document.
 */
const createBetterAuthClient = ({
  baseUrl,
  fetch,
  credentials,
  onAuthToken,
}: ControlPlaneAuthClientOptions) => {
  return createAuthClient({
    baseURL: baseUrl,
    ...(fetch || credentials || onAuthToken
      ? {
          fetchOptions: {
            ...(fetch ? { customFetchImpl: fetch } : {}),
            ...(credentials ? { credentials } : {}),
            ...(onAuthToken
              ? {
                  onSuccess: (context: { response: Response }) => {
                    const token = authTokenFromResponse(context.response);
                    if (token) onAuthToken(token);
                  },
                }
              : {}),
          },
        }
      : {}),
    plugins: [deviceAuthorizationClient(), twoFactorClient()],
  });
};

type BetterAuthClient = ReturnType<typeof createBetterAuthClient>;

export type ControlPlaneAuthClient = BetterAuthClient & {
  verifyDeviceAuthorization: (userCode: string) => Promise<DeviceAuthorizationVerificationResult>;
};

export const createControlPlaneAuthClient = ({
  baseUrl,
  fetch,
  credentials,
  onAuthToken,
}: ControlPlaneAuthClientOptions): ControlPlaneAuthClient => {
  const client = createBetterAuthClient({
    baseUrl,
    ...(fetch ? { fetch } : {}),
    ...(credentials ? { credentials } : {}),
    ...(onAuthToken ? { onAuthToken } : {}),
  });
  const verifyDeviceAuthorization = createDeviceAuthorizationVerifier({
    baseUrl,
    ...(fetch ? { fetch } : {}),
    ...(credentials ? { credentials } : {}),
  });
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "verifyDeviceAuthorization") return verifyDeviceAuthorization;
      return Reflect.get(target, property, receiver);
    },
  }) as ControlPlaneAuthClient;
};
