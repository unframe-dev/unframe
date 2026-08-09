import createClient from "openapi-fetch";
import type { paths } from "@unframe/contracts/control-plane";

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
