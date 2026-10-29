import { decodeWireMessage, encodeWireMessage } from "@unframe/contracts/presentation";
import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import {
  assertCheckpointJsonSize,
  parseCheckpointJson,
  validateCheckpoint,
} from "../../../src/modules/persistence-callback/checkpoint";
import { checkpointEnvelope } from "../../fixtures/checkpoint";

const recoveredBeforeParticipation = async (sequence = "0") => {
  const envelope = await checkpointEnvelope("session", sequence);
  const canonical = decodeWireMessage(
    "unframe.realtime.CanonicalRuntimeSnapshot",
    Uint8Array.from(atob(envelope.canonicalSnapshotPayload), (character) =>
      character.charCodeAt(0),
    ),
  );
  if (sequence === "0") delete canonical["reliableSequence"];
  canonical["clock"] = { paused: { reason: 3 } };
  const recovery = decodeWireMessage(
    "unframe.realtime.RuntimeRecoveryMetadata",
    Uint8Array.from(atob(envelope.recoveryPayload), (character) => character.charCodeAt(0)),
  );
  recovery["participants"] = [];
  const synchronization = recovery["inputSynchronization"] as Record<string, unknown>;
  delete synchronization["reliableSequence"];
  synchronization["phase"] = 1;
  const canonicalBytes = encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", canonical);
  const recoveryBytes = encodeWireMessage("unframe.realtime.RuntimeRecoveryMetadata", recovery);
  const hash = async (bytes: Uint8Array) =>
    `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return {
    ...envelope,
    canonicalSnapshotPayload: btoa(String.fromCharCode(...canonicalBytes)),
    canonicalSnapshotHash: await hash(canonicalBytes),
    recoveryPayload: btoa(String.fromCharCode(...recoveryBytes)),
    recoveryHash: await hash(recoveryBytes),
  };
};

describe("durable checkpoint boundary", () => {
  it("accepts a v3 checkpoint with matching canonical and recovery cut", async () => {
    const envelope = await checkpointEnvelope();
    await expect(validateCheckpoint(envelope)).resolves.toEqual(envelope);
  });
  it.each([false, true])(
    "accepts a paused initial recovery checkpoint with empty participation and zero sequence (omitted envelope zero: %s)",
    async (omitEnvelopeZero) => {
      const original = await recoveredBeforeParticipation();
      const { reliableSequence: _, ...withoutSequence } = original;
      const envelope = omitEnvelopeZero ? withoutSequence : original;
      await expect(
        validateCheckpoint(envelope, {
          sessionId: "session",
          runtimeId: "runtime",
          runtimeKind: "Cloud",
          assignmentEpoch: 1,
          checkpointSequence: 1,
          reliableSequence: 0,
        }),
      ).resolves.toEqual(envelope);
    },
  );
  it("rejects a progressed checkpoint that has no participant history even when synchronization sequence is zero", async () => {
    await expect(validateCheckpoint(await recoveredBeforeParticipation("5"))).rejects.toMatchObject(
      { status: 400 },
    );
  });
  it("rejects a v2 envelope without migration", async () => {
    await expect(
      validateCheckpoint({ ...(await checkpointEnvelope()), schemaVersion: 2 }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("requires recovery metadata", async () => {
    const { recoveryPayload: _, recoveryHash: __, ...envelope } = await checkpointEnvelope();
    await expect(validateCheckpoint(envelope)).rejects.toMatchObject({ status: 400 });
  });
  it("rejects recovery from a different input cut even with a matching hash", async () => {
    const envelope = await checkpointEnvelope();
    const recovery = decodeWireMessage(
      "unframe.realtime.RuntimeRecoveryMetadata",
      Uint8Array.from(atob(envelope.recoveryPayload), (c) => c.charCodeAt(0)),
    );
    const sync = recovery["inputSynchronization"] as Record<string, unknown>;
    (sync["inputContext"] as Record<string, unknown>)["inputEpoch"] = "2";
    const encoded = encodeWireMessage("unframe.realtime.RuntimeRecoveryMetadata", recovery);
    envelope.recoveryPayload = btoa(String.fromCharCode(...encoded));
    envelope.recoveryHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    await expect(validateCheckpoint(envelope)).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    ["canonicalSnapshotPayload", 786433],
    ["recoveryPayload", 262145],
  ] as const)("rejects oversized %s before decoding", async (field, size) => {
    const envelope = await checkpointEnvelope();
    Object.assign(envelope, {
      [field]: "A".repeat(Math.floor(size / 3) * 4) + ["", "AA==", "AAA="][size % 3],
    });
    await expect(validateCheckpoint(envelope)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed persisted JSON", async () => {
    await expect(parseCheckpointJson("{")).rejects.toMatchObject({ status: 400 });
  });
  it("measures the envelope limit as UTF-8 bytes and accepts the exact limit", () => {
    expect(() => assertCheckpointJsonSize("あ".repeat(524288))).not.toThrow();
    expect(() => assertCheckpointJsonSize("あ".repeat(524288) + "a")).toThrow(HTTPException);
  });
});
