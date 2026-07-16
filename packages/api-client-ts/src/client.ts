import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/schema";

export function createApiClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
