import { createApiClient } from "@unframe/api-client-ts";

export const apiClient = createApiClient({
  baseUrl: "http://localhost:8080",
});
