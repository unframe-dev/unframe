import createClient from "openapi-fetch";
import type { paths } from "@unframe/contracts/control-plane";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient, twoFactorClient } from "better-auth/client/plugins";

export type ControlPlaneClient = ReturnType<typeof createClient<paths>>;

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
  createClient<paths>({
    baseUrl,
    ...(fetch ? { fetch } : {}),
    ...(credentials ? { credentials } : {}),
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

/**
 * Better Auth v1 client contract for browser authentication, MFA, and device authorization.
 * This is versioned independently because Better Auth endpoints are not part of
 * the Control Plane OpenAPI document.
 */
export const createControlPlaneAuthClient = ({
  baseUrl,
  fetch,
  credentials,
  onAuthToken,
}: ControlPlaneAuthClientOptions) =>
  createAuthClient({
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

export type ControlPlaneAuthClient = ReturnType<typeof createControlPlaneAuthClient>;
