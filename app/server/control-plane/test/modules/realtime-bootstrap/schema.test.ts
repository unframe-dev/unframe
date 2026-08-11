import { describe, expect, it } from "vitest";
import { realtimeBootstrapCredentialInputSchema } from "../../../src/modules/realtime-bootstrap/schema";

describe("realtime bootstrap credential input", () => {
  it("accepts a participant role and stable identifiers", () => {
    expect(
      realtimeBootstrapCredentialInputSchema.safeParse({
        sessionId: "session-1",
        userId: "user_1",
        role: "viewer",
      }).success,
    ).toBe(true);
  });

  it.each([
    { sessionId: "session 1", userId: "user-1", role: "viewer" },
    { sessionId: "session-1", userId: "user-1", role: "admin" },
    { sessionId: "session-1", userId: "user-1", role: "viewer", extra: true },
  ])("rejects invalid input", (input) => {
    expect(realtimeBootstrapCredentialInputSchema.safeParse(input).success).toBe(false);
  });
});
