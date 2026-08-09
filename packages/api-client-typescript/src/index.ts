import createClient from "openapi-fetch";
import type { paths } from "@unframe/contracts/control-plane";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

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
};

/**
 * Better Auth v1 client contract for Google sessions and device authorization.
 * This is versioned independently because Better Auth endpoints are not part of
 * the Control Plane OpenAPI document.
 */
export const createControlPlaneAuthClient = ({
  baseUrl,
  fetch,
  credentials,
}: ControlPlaneAuthClientOptions) =>
  createAuthClient({
    baseURL: baseUrl,
    ...(fetch || credentials
      ? {
          fetchOptions: {
            ...(fetch ? { customFetchImpl: fetch } : {}),
            ...(credentials ? { credentials } : {}),
          },
        }
      : {}),
    plugins: [deviceAuthorizationClient()],
  });

export type ControlPlaneAuthClient = ReturnType<typeof createControlPlaneAuthClient>;
