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
  let finish!: (job: import("@unframe/unframe-cli/author-contract").BuildJob) => void;
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
