import { createControlPlaneClient } from "@unframe/api-client-typescript";
import { authenticatedFetch } from "./authenticated-fetch";

export const controlPlaneClient = createControlPlaneClient({
  baseUrl: import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me",
  credentials: "include",
  fetch: authenticatedFetch,
});
