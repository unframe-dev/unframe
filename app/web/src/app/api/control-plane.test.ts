import { describe, expect, it, vi } from "vitest";

const { createControlPlaneClient } = vi.hoisted(() => ({
  createControlPlaneClient: vi.fn(() => ({ presentations: { $get: vi.fn() } })),
}));

vi.mock("@unframe/api-client-typescript", () => ({ createControlPlaneClient }));

describe("controlPlane", () => {
  it("uses cookie credentials for Control Plane RPC requests", async () => {
    await import("./control-plane");

    expect(createControlPlaneClient).toHaveBeenCalledWith({
      baseUrl: "https://api.un-fra.me",
      credentials: "include",
    });
  });
});
