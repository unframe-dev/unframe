import { expect, it, vi } from "vitest";
import { createPublicationController } from "../publication-controller";
import type { HostApi } from "../../infra/host-api";

it("keeps publication pinned to the displayed Dist and rejects a mismatched result", async () => {
  const publish = vi.fn(async () => ({ ok: true as const, buildId: "other", publicationEpoch: 1 }));
  const api = {
    publicationAuth: async () => ({ status: "authenticated" as const }),
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
  let finish!: (job: import("@unframe/contracts/author-http").BuildJob) => void;
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
    publicationAuth: async () => ({ status: "authenticated" }),
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
    publicationAuth: async () => ({ status: "authenticated" }),
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
