import { audienceWebCapabilityProfileId } from "@unframe/contracts/presentation";
import { createAudienceHttpClient } from "./http-client";

export function readConnectionConfig(
  environment: Record<string, unknown>,
):
  | { status: "unconfigured" | "invalid" }
  | { status: "configured"; config: { apiOrigin: string; capabilityProfileId: string } } {
  const apiOrigin = environment.VITE_AUDIENCE_API_ORIGIN;
  if (apiOrigin === undefined || apiOrigin === "") return { status: "unconfigured" };
  if (typeof apiOrigin !== "string") return { status: "invalid" };
  const config = { apiOrigin, capabilityProfileId: audienceWebCapabilityProfileId };
  try {
    createAudienceHttpClient(config);
    return { status: "configured", config };
  } catch {
    return { status: "invalid" };
  }
}
