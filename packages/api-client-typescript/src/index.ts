import type { AppType } from "@unframe/control-plane/rpc";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient, twoFactorClient } from "better-auth/client/plugins";
import { hc } from "hono/client";

export type ControlPlaneClient = ReturnType<typeof hc<AppType>>;

export type ControlPlaneClientOptions = {
  baseUrl: string;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
};

export const createControlPlaneClient = ({
  baseUrl,
  credentials,
  fetch,
}: ControlPlaneClientOptions): ControlPlaneClient =>
  hc<AppType>(baseUrl, {
    ...(fetch ? { fetch } : {}),
    ...(credentials ? { init: { credentials } } : {}),
  });

export type ControlPlaneAuthClientOptions = {
  baseUrl: string;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
  onAuthToken?: (token: string) => void;
};

/** Extracts the Bearer credential emitted by Better Auth's bearer plugin. */
export const authTokenFromResponse = (response: Response): string | undefined =>
  response.headers.get("set-auth-token") ?? undefined;
export type DeviceAuthorizationVerification = {
  status: "pending" | "approved" | "denied";
  user_code: string;
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
  credentials,
  fetch: customFetch,
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
      const parsed: unknown = await response.json();
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Better Auth errors may not have a JSON response body.
    }

    if (
      response.ok &&
      typeof body["user_code"] === "string" &&
      (body["status"] === "pending" || body["status"] === "approved" || body["status"] === "denied")
    ) {
      return { data: { status: body["status"], user_code: body["user_code"] }, error: null };
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
  credentials,
  fetch,
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
                    if (token) {
                      onAuthToken(token);
                    }
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
  credentials,
  fetch,
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
      if (property === "verifyDeviceAuthorization") {
        return verifyDeviceAuthorization;
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ControlPlaneAuthClient;
};
