import { afterEach, expect, it, vi } from "vitest";
import { encodeWireMessage, type DeliveryManifestWire } from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createAudienceHttpClient, type Session, type Bootstrap } from "../http-client";
import { createJoinController } from "../join-controller";

const now = Date.parse("2026-10-23T00:00:00Z");
const capabilityProfileId = "synthetic-test-only";
function input() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
  for (const asset of delivery.assetAccess ?? []) asset.expiresAtUnixMs = String(now + 120_000);
  const publication = delivery.publication!;
  const session: Session = {
    id: delivery.sessionId!,
    presentationId: publication.presentationId!,
    presenterId: "presenter",
    state: "Presenting",
    participantCount: 2,
    maxParticipants: 50,
    createdAt: new Date(now).toISOString(),
    endedAt: null,
    publicationFence: {
      presentationId: publication.presentationId!,
      publicationEpoch: Number(publication.publicationEpoch),
      publicationManifestHash: publication.publicationManifestHash!,
    },
  };
  const bootstrap: Bootstrap = {
    endpoint: "https://runtime.example.test/realtime",
    fingerprint: null,
    runtimeId: "runtime",
    runtimeKind: "Cloud",
    assignmentEpoch: Number(delivery.projectionInstance!.assignmentEpoch),
    presentationId: session.presentationId,
    presentationRevision: 1,
    credential: "private-test-credential",
    expiresAt: new Date(now + 60_000).toISOString(),
    publicationFence: { ...session.publicationFence! },
    projectionProfileId: delivery.projectionProfile!.projectionProfileId!,
  };
  return { session, delivery, bootstrap };
}
function setup(responses: Response[]) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createAudienceHttpClient(
    { apiOrigin: "https://control.example.test", capabilityProfileId },
    { fetch, now: () => now },
  );
  const controller = createJoinController({ client, capabilityProfileId, now: () => now });
  return { controller, fetch };
}
function deliveryResponse(delivery: DeliveryManifestWire) {
  return new Response(
    new Uint8Array(encodeWireMessage("unframe.delivery.DeliveryManifest", delivery)),
    { headers: { "content-type": "application/x-protobuf" } },
  );
}
afterEach(() => vi.useRealTimers());

it("joins through real JSON/protobuf HTTP boundaries and exposes a prepared connection", async () => {
  const { session, delivery, bootstrap } = input();
  const { controller, fetch } = setup([
    Response.json(session),
    deliveryResponse(delivery),
    Response.json(bootstrap),
  ]);
  try {
    await controller.join("abcd-efgh");
    expect(controller.getSnapshot().phase).toBe("prepared");
    expect(controller.getPrepared()).toMatchObject({
      session: { id: session.id },
      delivery: { sessionId: session.id },
      bootstrap: { credential: bootstrap.credential },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://control.example.test/sessions/join",
      `https://control.example.test/sessions/${session.id}/delivery`,
      `https://control.example.test/sessions/${session.id}/bootstrap`,
    ]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body))).toEqual({ capabilityProfileId });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(bootstrap.credential);
  } finally {
    controller.dispose();
  }
});

it("rejects a bootstrap fence inconsistent with the decoded Delivery", async () => {
  const { session, delivery, bootstrap } = input();
  bootstrap.assignmentEpoch += 1;
  const { controller, fetch } = setup([
    Response.json(session),
    deliveryResponse(delivery),
    Response.json(bootstrap),
  ]);
  try {
    await controller.join("ABCD-EFGH");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "delivery-mismatch" });
    expect(controller.getPrepared()).toBeNull();
  } finally {
    controller.dispose();
  }
});

it("stops the HTTP chain after join returns 401", async () => {
  const { controller, fetch } = setup([
    Response.json(
      { error: { code: "unauthorized", message: "private-server-detail" } },
      { status: 401 },
    ),
  ]);
  try {
    await controller.join("ABCD-EFGH");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({ phase: "error", error: "unauthorized" });
    expect(controller.getPrepared()).toBeNull();
  } finally {
    controller.dispose();
  }
});
