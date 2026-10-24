import { afterEach, expect, test, vi } from "vitest";
import fixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createJoinController } from "./join-controller";
import { AudienceConnectionError, type Bootstrap, type Session } from "./http-client";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";

const clock = Date.parse("2026-10-23T00:00:00Z");
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 120_000);
  });
  const session: Session = {
    id: delivery.sessionId!,
    presentationId: delivery.publication!.presentationId!,
    publicationFence: {
      ...delivery.publication!,
      publicationEpoch: 1,
    } as Session["publicationFence"],
    presenterId: "presenter",
    state: "Presenting",
    participantCount: 2,
    maxParticipants: 50,
    createdAt: new Date(clock).toISOString(),
    endedAt: null,
  };
  const bootstrap: Bootstrap = {
    endpoint: "https://realtime.example.test",
    fingerprint: null,
    runtimeId: "runtime",
    runtimeKind: "Cloud",
    assignmentEpoch: 1,
    presentationId: session.presentationId,
    presentationRevision: 1,
    credential: "secret-credential",
    expiresAt: new Date(clock + 60_000).toISOString(),
    publicationFence: session.publicationFence!,
    projectionProfileId: delivery.projectionProfile!.projectionProfileId!,
  };
  const client = {
    join: vi.fn(async () => session),
    delivery: vi.fn(async () => delivery),
    bootstrap: vi.fn(async () => bootstrap),
  };
  const controller = createJoinController({ client, capabilityProfileId: "synthetic-test-only" });
  return { controller, client, session, delivery, bootstrap };
}
afterEach(() => vi.useRealTimers());

test("join→Delivery→bootstrapの順に取得し資格を画面状態へ公開しない", async () => {
  const { controller, client, delivery } = setup();
  const phases: string[] = [];
  controller.subscribe(() => phases.push(controller.getSnapshot().phase));
  await controller.join("ABCD-EFGH");
  expect(phases).toEqual(["joining", "delivery", "bootstrap", "prepared"]);
  expect(client.delivery).toHaveBeenCalledWith(delivery.sessionId, expect.any(AbortSignal));
  expect(controller.getPrepared()?.delivery.sessionId).toBe(delivery.sessionId);
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("secret-credential");
  controller.dispose();
});

test("失敗した工程の後を呼ばずHTTP資格エラーを表示用コードに変換", async () => {
  const { controller, client } = setup();
  client.join.mockRejectedValue(new AudienceConnectionError("http-error", 401));
  await controller.join("ABCD-EFGH");
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "unauthorized" });
  expect(client.delivery).not.toHaveBeenCalled();
  expect(controller.getPrepared()).toBeNull();
});

test("取消後に旧要求が完了しても復帰させず再参加できる", async () => {
  const { controller, client, session } = setup();
  let resolve!: (value: Session) => void;
  client.join.mockImplementationOnce(
    () =>
      new Promise<Session>((done) => {
        resolve = done;
      }),
  );
  const first = controller.join("ABCD-EFGH");
  controller.cancel();
  await controller.join("JKLM-NPQR");
  resolve(session);
  await first;
  expect(controller.getSnapshot().phase).toBe("prepared");
  expect(client.delivery).toHaveBeenCalledTimes(1);
  controller.dispose();
});

test.each(["viewer", "session", "profile", "publication", "assignment", "projection"])(
  "%s不一致では確定しない",
  async (field) => {
    const { controller, delivery, bootstrap } = setup();
    if (field === "viewer") delivery.projectionProfile!.key!.role = 1;
    if (field === "session") delivery.sessionId = "other";
    if (field === "profile") delivery.capabilityProfile!.capabilityProfileId = "other";
    if (field === "publication")
      bootstrap.publicationFence.publicationManifestHash = `sha256:${"0".repeat(64)}`;
    if (field === "assignment") bootstrap.assignmentEpoch = 2;
    if (field === "projection") bootstrap.projectionProfileId = "other";
    await controller.join("ABCD-EFGH");
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "delivery-mismatch" });
    expect(controller.getPrepared()).toBeNull();
  },
);

test("期限到達で資格と素材URLを破棄し更新は同じsessionから開始", async () => {
  const { controller, client, bootstrap, delivery } = setup();
  delivery.assetAccess![0]!.expiresAtUnixMs = String(clock + 1000);
  await controller.join("ABCD-EFGH");
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
  expect(controller.getPrepared()).toBeNull();
  bootstrap.expiresAt = new Date(clock + 120_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 120_000);
  });
  await controller.refresh();
  expect(client.join).toHaveBeenCalledTimes(1);
  expect(client.delivery).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().phase).toBe("prepared");
  controller.leave();
  expect(controller.getPrepared()).toBeNull();
  expect(controller.getSnapshot()).toEqual({ phase: "idle" });
});

test("同じsessionの情報更新で公開物が変わった場合は混ぜず拒否", async () => {
  const { controller, delivery } = setup();
  await controller.join("ABCD-EFGH");
  delivery.publication!.publicationEpoch = "2";
  await controller.refresh();
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "delivery-mismatch" });
  expect(controller.getPrepared()).toBeNull();
});

test("取得済みデータを呼出元が変更しても保管中の資格を変更しない", async () => {
  const { controller } = setup();
  await controller.join("ABCD-EFGH");
  controller.getPrepared()!.bootstrap.credential = "changed";
  expect(controller.getPrepared()?.bootstrap.credential).toBe("secret-credential");
  controller.dispose();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(controller.getPrepared()).toBeNull();
});

test("joinのfenceがnullでも最初の公開物を固定し更新時に変更を拒否", async () => {
  const { controller, session, delivery, bootstrap } = setup();
  session.publicationFence = null;
  await controller.join("ABCD-EFGH");
  expect(controller.getSnapshot().phase).toBe("prepared");
  delivery.publication!.publicationEpoch = "2";
  delivery.projectionProfile!.key!.publication!.publicationEpoch = "2";
  bootstrap.publicationFence.publicationEpoch = 2;
  await controller.refresh();
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "delivery-mismatch" });
  expect(controller.getPrepared()).toBeNull();
});

test("同公開物のassignment変更は更新したDeliveryとbootstrapが一致すれば受理", async () => {
  const { controller, delivery, bootstrap } = setup();
  await controller.join("ABCD-EFGH");
  delivery.projectionInstance!.assignmentEpoch = "2";
  bootstrap.assignmentEpoch = 2;
  await controller.refresh();
  expect(controller.getSnapshot().phase).toBe("prepared");
  expect(controller.getPrepared()?.bootstrap.assignmentEpoch).toBe(2);
  controller.dispose();
});

test("バックグラウンドでtimerが遅れても利用時に期限切れを拒否", async () => {
  const { controller } = setup();
  await controller.join("ABCD-EFGH");
  vi.setSystemTime(clock + 120_000);
  expect(controller.getPrepared()).toBeNull();
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
});

test("終了済sessionではDeliveryを要求しない", async () => {
  const { controller, session, client } = setup();
  session.state = "Ended";
  await controller.join("ABCD-EFGH");
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "session-ended" });
  expect(client.delivery).not.toHaveBeenCalled();
});
