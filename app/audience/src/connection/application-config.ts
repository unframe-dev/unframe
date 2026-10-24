import { createAudienceHttpClient } from "./http-client";

export function readConnectionConfig(
  environment: Record<string, unknown>,
):
  | { status: "unconfigured" | "invalid" }
  | { status: "configured"; config: { apiOrigin: string; capabilityProfileId: string } } {
  const apiOrigin = environment.VITE_AUDIENCE_API_ORIGIN;
  const capabilityProfileId = environment.VITE_AUDIENCE_CAPABILITY_PROFILE_ID;
  if (!apiOrigin && !capabilityProfileId) return { status: "unconfigured" };
  if (
    typeof apiOrigin !== "string" ||
    !apiOrigin ||
    typeof capabilityProfileId !== "string" ||
    !capabilityProfileId
  )
    return { status: "invalid" };
  const config = { apiOrigin, capabilityProfileId };
  try {
    createAudienceHttpClient(config);
    return { status: "configured", config };
  } catch {
    return { status: "invalid" };
  }
}
