import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requireSession } from "./require-session";
import { notifySessionChanged } from "@/shared/api/session-events";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@unframe/api-client-typescript", () => ({
  createControlPlaneAuthClient: vi.fn(() => auth),
}));

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
  auth.getSession.mockReset();
});
afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

it("redirects an unauthenticated session to login", async () => {
  auth.getSession.mockResolvedValue({ data: null, error: null });
  await expect(requireSession(queryClient)).rejects.toMatchObject({
    options: { to: "/login", replace: true },
  });
});

it("reuses a recent session check across protected navigations", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { expiresAt: new Date(Date.now() + 3_600_000) } },
    error: null,
  });
  await requireSession(queryClient);
  await requireSession(queryClient);
  expect(auth.getSession).toHaveBeenCalledTimes(1);
});

it("rechecks a session response that predates an authentication change", async () => {
  let respond!: (value: unknown) => void;
  auth.getSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const pending = requireSession(queryClient);
  notifySessionChanged();
  auth.getSession.mockResolvedValue({ data: null, error: null });
  respond({
    data: {
      user: { id: "previous-user" },
      session: { expiresAt: new Date(Date.now() + 3_600_000) },
    },
    error: null,
  });
  await expect(pending).rejects.toMatchObject({ options: { to: "/login" } });
  expect(auth.getSession).toHaveBeenCalledTimes(2);
});

it("rechecks an obsolete failed session request after authentication changes", async () => {
  let reject!: (reason: Error) => void;
  auth.getSession.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = requireSession(queryClient);
  notifySessionChanged();
  auth.getSession.mockResolvedValue({
    data: {
      user: { id: "current-user" },
      session: { expiresAt: new Date(Date.now() + 3_600_000) },
    },
    error: null,
  });
  reject(new Error("previous request failed"));
  await expect(pending).resolves.toBeUndefined();
  expect(auth.getSession).toHaveBeenCalledTimes(2);
});

it("refreshes the session after one minute and redirects when it has been revoked", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  auth.getSession.mockResolvedValueOnce({
    data: { session: { expiresAt: new Date(Date.now() + 3_600_000) } },
    error: null,
  });
  await requireSession(queryClient);

  vi.setSystemTime(Date.now() + 60_000);
  auth.getSession.mockResolvedValue({ data: null, error: null });
  await expect(requireSession(queryClient)).rejects.toMatchObject({
    options: { to: "/login", replace: true },
  });
});

it("checks again when the session expires before the cache becomes stale", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  auth.getSession.mockResolvedValueOnce({
    data: { session: { expiresAt: new Date(Date.now() + 1_000) } },
    error: null,
  });
  await requireSession(queryClient);

  vi.setSystemTime(Date.now() + 1_000);
  auth.getSession.mockResolvedValue({ data: null, error: null });
  await expect(requireSession(queryClient)).rejects.toMatchObject({
    options: { to: "/login", replace: true },
  });
});

it("checks again after a signed-out user logs in", async () => {
  auth.getSession.mockResolvedValueOnce({ data: null, error: null });
  await expect(requireSession(queryClient)).rejects.toMatchObject({
    options: { to: "/login" },
  });

  auth.getSession.mockResolvedValue({
    data: { session: { expiresAt: new Date(Date.now() + 3_600_000) } },
    error: null,
  });
  await expect(requireSession(queryClient)).resolves.toBeUndefined();
});

it("redirects on a session request failure and allows a later check to recover", async () => {
  auth.getSession.mockRejectedValueOnce(new Error("offline"));
  await expect(requireSession(queryClient)).rejects.toMatchObject({
    options: { to: "/login" },
  });

  auth.getSession.mockResolvedValue({
    data: { session: { expiresAt: new Date(Date.now() + 3_600_000) } },
    error: null,
  });
  await expect(requireSession(queryClient)).resolves.toBeUndefined();
});
