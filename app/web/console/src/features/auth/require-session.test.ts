import { expect, it, vi } from "vitest";
import { requireSession } from "./require-session";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@unframe/api-client-typescript", () => ({
  createControlPlaneAuthClient: vi.fn(() => auth),
}));

it("redirects an unauthenticated session to login", async () => {
  auth.getSession.mockResolvedValue({ data: null, error: null });
  await expect(requireSession()).rejects.toMatchObject({
    options: { to: "/login", replace: true },
  });
});
