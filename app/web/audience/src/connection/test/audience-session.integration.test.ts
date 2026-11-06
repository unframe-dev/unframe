// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Bootstrap, Session } from "../http-client";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";

const mock = vi.hoisted(() => ({
  client: {
    join: vi.fn<() => Promise<Session>>(),
    delivery: vi.fn<() => Promise<DeliveryManifestWire>>(),
    bootstrap: vi.fn<() => Promise<Bootstrap>>(),
  },
  disposeViewer: vi.fn(),
  updateViewer: vi.fn(),
}));
vi.mock("../application-config", () => ({
  readConnectionConfig: () => ({
    status: "configured",
    config: { apiOrigin: "https://api.example.test", capabilityProfileId: "synthetic-test-only" },
  }),
}));
vi.mock("../anonymous-client", () => ({ createAnonymousAudienceClient: () => mock.client }));
vi.mock("../../experience/viewer-application", () => ({
  createViewerApplication: () => ({ update: mock.updateViewer, dispose: mock.disposeViewer }),
}));
import { createAudienceSession } from "../audience-session";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test.each(["expiry-timer", "background-return"])(
  "%s keeps the existing camera application while reacquiring expired connection data",
  async (trigger) => {
    vi.useFakeTimers();
    const now = Date.parse("2026-11-06T08:00:00Z");
    vi.setSystemTime(now);
    const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
    delivery.projectionProfile!.key!.role = 2;
    for (const access of delivery.assetAccess!) access.expiresAtUnixMs = String(now + 120_000);
    const publication = {
      ...delivery.publication!,
      publicationEpoch: Number(delivery.publication!.publicationEpoch),
    } as Bootstrap["publicationFence"];
    const session = {
      id: delivery.sessionId!,
      presentationId: publication.presentationId,
      publicationFence: publication,
      state: "Presenting",
    } as Session;
    const bootstrap = {
      endpoint: "https://runtime.example.test",
      runtimeId: "runtime",
      assignmentEpoch: Number(delivery.projectionInstance!.assignmentEpoch),
      presentationId: publication.presentationId,
      credential: "test-credential",
      expiresAt: new Date(now + 1000).toISOString(),
      publicationFence: publication,
      projectionProfileId: delivery.projectionProfile!.projectionProfileId!,
    } as Bootstrap;
    mock.client.join.mockResolvedValue(session);
    mock.client.delivery.mockResolvedValue(delivery);
    mock.client.bootstrap.mockResolvedValue(bootstrap);
    const application = createAudienceSession({ environment: {} });
    application.start();
    try {
      await application.controller!.join("ABCD-EFGH");
      await vi.waitFor(() => expect(application.getViewer()).not.toBeNull());
      const viewer = application.getViewer();
      if (trigger === "expiry-timer") await vi.advanceTimersByTimeAsync(1000);
      else {
        vi.setSystemTime(now + 1000);
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      }
      expect(application.controller!.getPrepared()).toBeNull();
      expect(application.store.getState().screen).toBe("viewer");
      expect(application.getViewer()).toBe(viewer);
      expect(mock.updateViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({ recovering: true }),
      );
      expect(mock.disposeViewer).not.toHaveBeenCalled();
      bootstrap.expiresAt = new Date(now + 120_000).toISOString();
      await vi.advanceTimersByTimeAsync(250);
      expect(application.controller!.getSnapshot().phase).toBe("prepared");
      expect(application.getViewer()).toBe(viewer);
      expect(mock.updateViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({ recovering: false }),
      );
      expect(mock.disposeViewer).not.toHaveBeenCalled();
      expect(mock.client.join).toHaveBeenCalledTimes(1);
    } finally {
      application.dispose();
    }
  },
);
