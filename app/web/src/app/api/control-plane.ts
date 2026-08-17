import { createControlPlaneClient } from "@unframe/api-client-typescript";

const controlPlaneUrl = import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me";

export const controlPlane = createControlPlaneClient({
  baseUrl: controlPlaneUrl,
  credentials: "include",
});
