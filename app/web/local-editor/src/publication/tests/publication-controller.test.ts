import { expect, it, vi } from "vite-plus/test";
import { createPublicationController } from "../publication-controller";
import type { HostApi } from "../../infra/host-api";

it("keeps publication pinned to the displayed Dist and rejects a mismatched result", async () => {
  const publish = vi.fn(async () => ({ ok: true as const, buildId: "other", publicationEpoch: 1 }));
  const api = {
    subscribePublicationAuth: (listener: (state: { status: "authenticated" }) => void) => {
      listener({ status: "authenticated" });
      return () => undefined;
    },
    publish,
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  await controller.start();
  controller.setReceipt({ requestId: "displayed", buildIdentity: "fixed" });
  await controller.publish();
  expect(publish).toHaveBeenCalledWith("displayed", expect.any(AbortSignal));
  expect(controller.store.getState().result).toBeNull();
  expect(controller.store.getState().error).toContain("identity");
  controller.dispose();
});

it("cancels a Dist build whose creation finishes after disposal", async () => {
  let finish!: (job: import("@unframe-dev/contracts/author-http").BuildJob) => void;
  const cancel = vi.fn(async () => ({}));
  const api = {
    distBuild: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    cancel,
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  const pending = controller.build("r");
  controller.dispose();
  finish({
    buildId: "late",
    channel: "dist",
    revision: "r",
    generationId: null,
    status: "queued",
    diagnostics: [],
    artifacts: [],
  });
  await pending;
  expect(cancel).toHaveBeenCalledWith("late");
  expect(controller.store.getState().job).toBeNull();
});

it("retains an unknown publication and confirms its receipt without publishing again", async () => {
  const operation = {
    presentationId: "p",
    buildId: "fixed",
    publicationEpoch: 2,
    definitionHash: `sha256:${"a".repeat(64)}`,
    renderBundleHash: `sha256:${"b".repeat(64)}`,
    assetSetHash: `sha256:${"c".repeat(64)}`,
  };
  const unknown = {
    ok: false as const,
    code: "cli-publish-outcome-unknown" as const,
    outcome: "outcome-unknown" as const,
    operation,
  };
  const publish = vi.fn(async () => unknown);
  const publicationStatus = vi
    .fn()
    .mockResolvedValueOnce(unknown)
    .mockResolvedValueOnce({ ok: true, buildId: "fixed", publicationEpoch: 2 });
  const api = {
    subscribePublicationAuth: (listener: (state: { status: "authenticated" }) => void) => {
      listener({ status: "authenticated" });
      return () => undefined;
    },
    publish,
    publicationStatus,
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  await controller.start();
  controller.setReceipt({ requestId: "displayed", buildIdentity: "fixed" });
  await controller.publish();
  expect(controller.store.getState().result).toBeNull();
  expect(controller.store.getState().unknown?.operation).toEqual(operation);
  controller.setReceipt({ requestId: "new-display", buildIdentity: "new-build" });
  await controller.publish();
  expect(publish).toHaveBeenCalledTimes(1);
  await controller.checkPublication();
  expect(controller.store.getState().unknown?.requestId).toBe("displayed");
  await controller.checkPublication();
  expect(publicationStatus).toHaveBeenLastCalledWith("displayed", expect.any(AbortSignal));
  expect(controller.store.getState().unknown).toBeNull();
  expect(controller.store.getState().result).toEqual({
    ok: true,
    buildId: "fixed",
    publicationEpoch: 2,
    requestId: "displayed",
  });
  controller.dispose();
});

it("keeps an unknown publication when a receipt belongs to another operation", async () => {
  const unknown = {
    ok: false,
    code: "cli-publish-outcome-unknown",
    outcome: "outcome-unknown",
    operation: {
      presentationId: "p",
      buildId: "fixed",
      publicationEpoch: 2,
      definitionHash: `sha256:${"a".repeat(64)}`,
      renderBundleHash: `sha256:${"b".repeat(64)}`,
      assetSetHash: `sha256:${"c".repeat(64)}`,
    },
  };
  const api = {
    subscribePublicationAuth: (listener: (state: { status: "authenticated" }) => void) => {
      listener({ status: "authenticated" });
      return () => undefined;
    },
    publish: async () => unknown,
    publicationStatus: async () => ({ ok: true, buildId: "fixed", publicationEpoch: 3 }),
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  await controller.start();
  controller.setReceipt({ requestId: "displayed", buildIdentity: "fixed" });
  await controller.publish();
  await controller.checkPublication();
  expect(controller.store.getState().unknown?.requestId).toBe("displayed");
  expect(controller.store.getState().result).toBeNull();
  expect(controller.store.getState().error).toContain("receipt");
  controller.dispose();
});

it("uses only stream state despite late auth actions, supports repeated start and unsubscribes on dispose", async () => {
  let notify!: (state: import("@unframe-dev/contracts/author-http").PublicationAuth) => void;
  let finish!: (state: unknown) => void;
  const unsubscribe = vi.fn();
  const subscribePublicationAuth = vi.fn((listener) => {
    notify = listener;
    return unsubscribe;
  });
  const publicationAuth = vi.fn();
  const api = {
    subscribePublicationAuth,
    publicationAuth,
    beginPublicationAuth: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    cancelPublicationAuth: async () => {
      notify({ status: "signed-out" });
    },
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  await controller.start();
  await controller.start();
  expect(subscribePublicationAuth).toHaveBeenCalledOnce();
  notify({ status: "signed-out" });
  const starting = controller.authenticate();
  notify({ status: "authenticated", expiresAt: 10000 });
  finish({ status: "pending", userCode: "old" });
  await starting;
  expect(controller.store.getState().auth).toEqual({ status: "authenticated", expiresAt: 10000 });
  await controller.cancelAuth();
  expect(controller.store.getState().auth).toEqual({ status: "signed-out" });
  expect(publicationAuth).not.toHaveBeenCalled();
  notify({ status: "expired" });
  expect(controller.store.getState().auth).toEqual({ status: "expired" });
  controller.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  notify({ status: "authenticated" });
  expect(controller.store.getState().auth).toEqual({ status: "expired" });
});

it("keeps a reconnect snapshot when an older cancel response finishes later", async () => {
  let notify!: (state: import("@unframe-dev/contracts/author-http").PublicationAuth) => void;
  let finish!: () => void;
  const api = {
    subscribePublicationAuth: (listener: typeof notify) => {
      notify = listener;
      return () => undefined;
    },
    cancelPublicationAuth: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    publicationAuth: vi.fn(),
  } as unknown as HostApi;
  const controller = createPublicationController({ api, onDistBuilt: () => undefined });
  await controller.start();
  notify({ status: "pending", userCode: "old" });
  const cancelling = controller.cancelAuth();
  notify({ status: "signed-out" });
  notify({ status: "authenticated", expiresAt: 20000 });
  finish();
  await cancelling;
  expect(controller.store.getState().auth).toEqual({ status: "authenticated", expiresAt: 20000 });
  expect(api.publicationAuth).not.toHaveBeenCalled();
  controller.dispose();
});
