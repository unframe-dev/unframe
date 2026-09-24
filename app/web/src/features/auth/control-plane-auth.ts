import { createControlPlaneAuthClient } from "@unframe/api-client-typescript";

const controlPlaneUrl = import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me";

export const controlPlaneAuth = createControlPlaneAuthClient({
  baseUrl: controlPlaneUrl,
  credentials: "include",
});

export async function hasSession() {
  try {
    return Boolean((await controlPlaneAuth.getSession()).data);
  } catch {
    return false;
  }
}
