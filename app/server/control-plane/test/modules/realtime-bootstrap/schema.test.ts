import { describe, expect, it } from "vitest";
import { realtimeBootstrapCredentialInputSchema } from "../../../src/modules/realtime-bootstrap/schema";

describe("realtime bootstrap credential input", () => {
  const validInput = {
    sessionId: "session-1",
    userId: "user_1",
    role: "viewer",
    edgeId: "edge-1",
    assignmentEpoch: 3,
    presentationId: "presentation-1",
    presentationRevision: 7,
    scopes: ["realtime:connect", "assets:read"],
    expiresAt: 1_700_000_300,
  } as const;

  it("accepts an assignment-bound participant credential", () => {
    expect(realtimeBootstrapCredentialInputSchema.safeParse(validInput).success).toBe(true);
  });

  it.each([
    { ...validInput, sessionId: "session 1" },
    { ...validInput, role: "admin" },
    { ...validInput, assignmentEpoch: 0 },
    { ...validInput, presentationRevision: 0 },
    { ...validInput, scopes: [] },
    { ...validInput, scopes: ["unknown"] },
    { ...validInput, expiresAt: 0 },
    { ...validInput, extra: true },
  ])("rejects invalid input", (input) => {
    expect(realtimeBootstrapCredentialInputSchema.safeParse(input).success).toBe(false);
  });
});
