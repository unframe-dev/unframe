import { decodeWireMessage, encodeWireMessage } from "@unframe/contracts/presentation";
import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import {
  assertCheckpointJsonSize,
  parseCheckpointJson,
  validateCheckpoint,
} from "../../../src/modules/persistence-callback/checkpoint";
import { checkpointEnvelope } from "../../fixtures/checkpoint";

describe("durable checkpoint boundary", () => {
  it("accepts a v3 checkpoint with matching canonical and recovery cut", async () => {
    const envelope = await checkpointEnvelope();
    await expect(validateCheckpoint(envelope)).resolves.toEqual(envelope);
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
