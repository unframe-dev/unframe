import { createSessionRecorder } from "../../diagnostics/session-recorder";
import { afterEach, expect, test, vi } from "vitest";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createJoinController } from "../join-controller";
import {
  AudienceConnectionError,
  type Bootstrap,
  type Session,
  type createAudienceHttpClient,
} from "../http-client";
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
    delivery: vi.fn<ReturnType<typeof createAudienceHttpClient>["delivery"]>(async () => delivery),
    bootstrap: vi.fn(async () => bootstrap),
  };
  const recorder = createSessionRecorder();
  const controller = createJoinController({
    client,
    capabilityProfileId: "synthetic-test-only",
    recorder,
  });
  return { controller, client, session, delivery, bootstrap, recorder };
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

test.each([401, 403, 404, 410])(
  "確定拒否HTTP%sでは古い接続を破棄して再接続を停止する",
  async (status) => {
    const { controller, client } = setup();
    await controller.join("ABCD-EFGH");
    client.delivery.mockRejectedValue(new AudienceConnectionError("http-error", status));
    await controller.refresh();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(controller.getPrepared()).toBeNull();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(client.delivery).toHaveBeenCalledTimes(2);
    controller.dispose();
  },
);

test("明示的なSession終了では資格とtimerを破棄して終了状態を公開する", async () => {
  const { controller, client, session } = setup();
  await controller.join("ABCD-EFGH");
  client.delivery.mockRejectedValue(new AudienceConnectionError("session-ended", 410));
  await controller.refresh();
  expect(controller.getSnapshot()).toEqual({
    phase: "ended",
    session: { id: session.id, state: "Ended" },
  });
  expect(controller.getPrepared()).toBeNull();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(client.delivery).toHaveBeenCalledTimes(2);
  controller.leave();
  expect(controller.getSnapshot()).toEqual({ phase: "idle" });
});

test("切断復帰はDeliveryとbootstrapを再取得して新assignmentへ接続し直す", async () => {
  const { controller, client, delivery, bootstrap } = setup();
  await controller.join("ABCD-EFGH");
  delivery.projectionInstance!.assignmentEpoch = "2";
  bootstrap.assignmentEpoch = 2;
  bootstrap.endpoint = "https://new-runtime.example.test";
  await controller.reconnect();
  expect(client.delivery).toHaveBeenCalledTimes(2);
  expect(client.bootstrap).toHaveBeenCalledTimes(2);
  expect(controller.getPrepared()?.bootstrap).toMatchObject({
    assignmentEpoch: 2,
    endpoint: "https://new-runtime.example.test",
  });
  controller.dispose();
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
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshError: "delivery-mismatch",
    revision: 1,
  });
  expect(controller.getPrepared()?.delivery.publication?.publicationEpoch).toBe("1");
  controller.dispose();
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
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshError: "delivery-mismatch",
    revision: 1,
  });
  expect(controller.getPrepared()?.delivery.publication?.publicationEpoch).toBe("1");
  controller.dispose();
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
  expect(controller.getSnapshot()).toMatchObject({ phase: "ended", session: { state: "Ended" } });
  expect(client.delivery).not.toHaveBeenCalled();
});

test("期限前に自動更新している間もpreparedと旧資格を維持し成功時だけrevisionを進める", async () => {
  const { controller, client, delivery, bootstrap } = setup();
  await controller.join("ABCD-EFGH");
  let complete!: (value: DeliveryManifestWire) => void;
  client.delivery.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshing: true,
    revision: 1,
  });
  expect(controller.getPrepared()?.bootstrap.credential).toBe("secret-credential");
  bootstrap.credential = "renewed-private-credential";
  bootstrap.expiresAt = new Date(clock + 180_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 180_000);
  });
  complete(delivery);
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshing: false,
    revision: 2,
    refreshError: null,
  });
  expect(controller.getPrepared()?.bootstrap.credential).toBe("renewed-private-credential");
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("private");
  expect(client.join).toHaveBeenCalledTimes(1);
  controller.dispose();
});

test("素材URLの最短期限を使って自動更新し失敗は既存接続を保持して再試行する", async () => {
  const { controller, client, delivery } = setup();
  delivery.assetAccess![0]!.expiresAtUnixMs = String(clock + 20_000);
  await controller.join("ABCD-EFGH");
  client.delivery.mockRejectedValue(new AudienceConnectionError("network-error"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshing: false,
    refreshError: "network-error",
    revision: 1,
  });
  expect(controller.getPrepared()).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(client.delivery).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
  expect(controller.getPrepared()).toBeNull();
  expect(client.delivery.mock.calls.length).toBeLessThanOrEqual(5);
});

test.each(["leave", "cancel", "dispose"] as const)(
  "%sは更新中の要求と全timerを取消し遅延応答を無視する",
  async (operation) => {
    const { controller, client, delivery } = setup();
    await controller.join("ABCD-EFGH");
    let complete!: (value: DeliveryManifestWire) => void;
    client.delivery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const work = controller.refresh();
    const signal = client.delivery.mock.calls.at(-1)?.[1] as AbortSignal | undefined;
    controller[operation]();
    expect(signal?.aborted).toBe(true);
    complete(delivery);
    await work;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(controller.getSnapshot()).toEqual({ phase: "idle" });
    expect(controller.getPrepared()).toBeNull();
    expect(client.delivery).toHaveBeenCalledTimes(2);
  },
);

test("更新を同時要求しても重複せず旧期限を過ぎた要求の完了で復帰しない", async () => {
  const { controller, client, delivery } = setup();
  await controller.join("ABCD-EFGH");
  let complete!: (value: DeliveryManifestWire) => void;
  client.delivery.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const first = controller.refresh();
  const second = controller.refresh();
  expect(client.delivery).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  complete(delivery);
  await Promise.all([first, second]);
  expect(controller.getPrepared()).toBeNull();
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
});

test("更新失敗後の再試行成功で期限とrevisionを進め以後の旧期限timerを解除する", async () => {
  const { controller, client, bootstrap, delivery } = setup();
  await controller.join("ABCD-EFGH");
  client.delivery.mockRejectedValueOnce(new AudienceConnectionError("network-error"));
  await vi.advanceTimersByTimeAsync(30_000);
  bootstrap.expiresAt = new Date(clock + 180_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 180_000);
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "prepared",
    refreshError: null,
    refreshing: false,
    revision: 2,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.getSnapshot().phase).toBe("prepared");
  expect(client.delivery).toHaveBeenCalledTimes(3);
  controller.dispose();
});

test("leaseにより期限を延ばせなくても更新要求が期限付近で無限発生しない", async () => {
  const { controller, client, bootstrap, delivery } = setup();
  bootstrap.expiresAt = new Date(clock + 2_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 2_000);
  });
  await controller.join("ABCD-EFGH");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(client.delivery).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
});

test("timerが止まった間に旧期限を過ぎた更新結果は新期限が有効でも採用しない", async () => {
  const { controller, client, bootstrap, delivery } = setup();
  await controller.join("ABCD-EFGH");
  let complete!: (value: DeliveryManifestWire) => void;
  client.delivery.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const work = controller.refresh();
  vi.setSystemTime(clock + 61_000);
  bootstrap.expiresAt = new Date(clock + 180_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 180_000);
  });
  complete(delivery);
  await work;
  expect(controller.getSnapshot()).toMatchObject({ phase: "error", error: "expired-connection" });
  expect(controller.getPrepared()).toBeNull();
});

test("接続履歴は取得結果を相関し資格やURLを記録せず退出後も保持する", async () => {
  const { controller, recorder, bootstrap } = setup();
  await controller.join("ABCD-EFGH");
  controller.leave();
  const data = recorder.export();
  expect(data.events.map((e) => e.event)).toEqual(
    expect.arrayContaining(["session.join", "delivery.received", "bootstrap.received"]),
  );
  expect(
    data.events.find((e) => e.event === "bootstrap.received" && e.stage === "success"),
  ).toMatchObject({ runtimeId: bootstrap.runtimeId, assignmentEpoch: "1", publicationEpoch: "1" });
  expect(JSON.stringify(data)).not.toMatch(/secret-credential|https:|ABCD-EFGH/);
});

test("Runtime復旧待ちは旧資格の期限を越えて再取得し新assignmentへ接続する", async () => {
  const { controller, client, delivery, bootstrap, recorder } = setup();
  await controller.join("ABCD-EFGH");
  client.delivery.mockRejectedValue(new AudienceConnectionError("runtime-unavailable", 409));
  await controller.reconnect();
  expect(controller.getSnapshot().phase).toBe("recovering");
  expect(recorder.export().events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: "connection.stage",
        stage: "failure",
        code: "runtime-unavailable",
      }),
      expect.objectContaining({ event: "connection.stage", stage: "recovering" }),
    ]),
  );
  expect(controller.getPrepared()).toBeNull();
  await vi.advanceTimersByTimeAsync(125_000);
  expect(controller.getSnapshot().phase).toBe("recovering");
  expect(client.join).toHaveBeenCalledTimes(1);
  expect(client.delivery.mock.calls.length).toBeGreaterThan(20);
  delivery.projectionInstance!.assignmentEpoch = "2";
  bootstrap.assignmentEpoch = 2;
  bootstrap.expiresAt = new Date(clock + 240_000).toISOString();
  delivery.assetAccess!.forEach((asset) => {
    asset.expiresAtUnixMs = String(clock + 240_000);
  });
  client.delivery.mockResolvedValue(delivery);
  await vi.advanceTimersByTimeAsync(5000);
  expect(controller.getSnapshot().phase).toBe("prepared");
  expect(controller.getPrepared()?.bootstrap.assignmentEpoch).toBe(2);
  controller.dispose();
});

test("Runtime復旧待ちのcancelは後続retryを止める", async () => {
  const { controller, client } = setup();
  client.delivery.mockRejectedValue(new AudienceConnectionError("runtime-unavailable", 409));
  await controller.join("ABCD-EFGH");
  expect(controller.getSnapshot().phase).toBe("recovering");
  controller.cancel();
  await vi.advanceTimersByTimeAsync(130_000);
  expect(controller.getSnapshot().phase).toBe("idle");
  expect(client.delivery).toHaveBeenCalledTimes(1);
});

test.each([
  new AudienceConnectionError("network-error"),
  new AudienceConnectionError("http-error", 429),
  new AudienceConnectionError("http-error", 503),
])("切断後の一時的な再取得失敗でも資格の期限を越えて復旧を待つ (%s)", async (failure) => {
  const { controller, client } = setup();
  await controller.join("ABCD-EFGH");
  client.delivery.mockRejectedValue(failure);
  await controller.reconnect();
  expect(controller.getPrepared()).toBeNull();
  expect(controller.getSnapshot().phase).toBe("recovering");
  await vi.advanceTimersByTimeAsync(125_000);
  expect(controller.getSnapshot().phase).toBe("recovering");
  expect(client.delivery.mock.calls.length).toBeGreaterThan(20);
  controller.dispose();
});
