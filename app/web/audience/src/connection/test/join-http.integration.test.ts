import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { encodeWireMessage, type DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createAudienceHttpClient, type Session, type Bootstrap } from "../http-client";
import { createJoinController } from "../join-controller";
import { createAudienceRealtime } from "../realtime-client";

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
    { fetch },
  );
  const controller = createJoinController({ client, capabilityProfileId });
  return { controller, fetch };
}
function deliveryResponse(delivery: DeliveryManifestWire) {
  return new Response(
    new Uint8Array(encodeWireMessage("unframe.delivery.DeliveryManifest", delivery)),
    { headers: { "content-type": "application/x-protobuf" } },
  );
}
afterEach(() => vi.useRealTimers());

it("renews asset URLs through HTTP without replacing either active Realtime stream", async () => {
  const { session, delivery, bootstrap } = input();
  bootstrap.expiresAt = new Date(now + 86_400_000).toISOString();
  const responses = [Response.json(session), deliveryResponse(delivery), Response.json(bootstrap)];
  for (const elapsed of [90_000, 180_000, 270_000]) {
    for (const asset of delivery.assetAccess!)
      asset.expiresAtUnixMs = String(now + elapsed + 120_000);
    responses.push(
      deliveryResponse(delivery),
      Response.json({
        ...bootstrap,
        credential: `renewed-${elapsed}`,
        expiresAt: new Date(now + elapsed + 86_400_000).toISOString(),
      }),
    );
  }
  const { controller } = setup(responses);
  class Socket extends EventTarget {
    readyState = 1;
    bufferedAmount = 0;
    binaryType = "arraybuffer";
    send() {}
    close() {
      this.readyState = 3;
    }
    receive(type: string, value: object) {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: new Uint8Array(encodeWireMessage(type, value)).buffer,
        }),
      );
    }
  }
  const sockets: Socket[] = [];
  const realtime = createAudienceRealtime({
    socket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const restart = vi.fn(() => null);
  const runtimeInput = {
    applyControl: vi.fn(),
    applyState: vi.fn(),
    disconnected: vi.fn(),
    restartState: vi.fn(),
    getReadiness: () => ({ reliableSequence: "1", presentationOriginVersion: "1" }),
  };
  try {
    await controller.join("ABCD-EFGH");
    const connection = controller.getPrepared();
    assert.isNotNull(connection);
    realtime.install(runtimeInput, connection, () => controller.getPrepared()!, restart);
    const control = sockets[0]!;
    control.dispatchEvent(new Event("open"));
    control.receive("unframe.realtime.ControlServerItem", {
      connectionSnapshot: {
        schemaVersion: 1,
        connectionId: "connection",
        reliableSequence: "1",
        fence: { presentationOriginVersion: "1" },
      },
    });
    control.receive("unframe.realtime.ControlServerItem", {
      stateConnectionNonce: { nonce: new Uint8Array([1]), expiresInMs: 30000 },
    });
    const state = sockets[1]!;
    state.dispatchEvent(new Event("open"));
    state.receive("unframe.realtime.StateServerItem", {
      connected: { connectionId: "connection", nextStateFrameSequence: "1" },
    });
    await vi.advanceTimersByTimeAsync(270_000);
    expect(controller.getPrepared()?.bootstrap).toEqual(bootstrap);
    expect(controller.getPrepared()?.delivery.assetAccess?.[0]?.expiresAtUnixMs).toBe(
      String(now + 390_000),
    );
    expect(sockets).toHaveLength(2);
    expect(control.readyState).toBe(1);
    expect(state.readyState).toBe(1);
    expect(restart).not.toHaveBeenCalled();
    expect(runtimeInput.disconnected).not.toHaveBeenCalled();
  } finally {
    realtime.dispose();
    controller.dispose();
  }
});

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
