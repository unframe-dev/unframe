import {
  decodeWireMessage,
  encodeWireMessage,
  runtimeAuthorityLimits,
} from "@unframe/contracts/presentation";
import { HTTPException } from "hono/http-exception";

const invalid = () =>
  new HTTPException(400, {
    res: Response.json(
      { error: { code: "validation_error", message: "Invalid checkpoint" } },
      { status: 400 },
    ),
  });
const tooLarge = () =>
  new HTTPException(413, {
    res: Response.json(
      {
        error: {
          code: "checkpoint_payload_too_large",
          message: "Checkpoint payload exceeds its byte limit",
        },
      },
      { status: 413 },
    ),
  });

export function assertCheckpointJsonSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > runtimeAuthorityLimits.maximumCheckpointJsonBytes)
    throw tooLarge();
}

export async function parseCheckpointJson(json: string): Promise<Record<string, unknown>> {
  assertCheckpointJsonSize(json);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw invalid();
  }
  return validateCheckpoint(value);
}

function bytes(value: unknown, maximum: number): Uint8Array {
  if (typeof value !== "string") throw invalid();
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (decoded.byteLength > maximum) throw tooLarge();
  return decoded;
}

async function hash(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type CheckpointIdentity = {
  sessionId: string;
  runtimeId: string;
  runtimeKind: "Cloud" | "VenueEdge";
  assignmentEpoch: number;
  checkpointSequence: number;
  reliableSequence: number;
};

export async function validateCheckpoint(
  value: unknown,
  expected?: CheckpointIdentity,
): Promise<Record<string, unknown>> {
  assertCheckpointJsonSize(JSON.stringify(value));
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
    const envelope = value as Record<string, unknown>;
    const canonicalBytes = bytes(
      envelope["canonicalSnapshotPayload"],
      runtimeAuthorityLimits.maximumCanonicalSnapshotBytes,
    );
    const recoveryBytes = bytes(
      envelope["recoveryPayload"],
      runtimeAuthorityLimits.maximumRecoveryMetadataBytes,
    );
    const runtimeKind =
      envelope["runtimeKind"] === "RUNTIME_KIND_CLOUD"
        ? 1
        : envelope["runtimeKind"] === "RUNTIME_KIND_VENUE_EDGE"
          ? 2
          : envelope["runtimeKind"];
    if (
      expected &&
      (envelope["sessionId"] !== expected.sessionId ||
        envelope["runtimeId"] !== expected.runtimeId ||
        runtimeKind !== (expected.runtimeKind === "Cloud" ? 1 : 2) ||
        envelope["assignmentEpoch"] !== String(expected.assignmentEpoch) ||
        envelope["checkpointSequence"] !== String(expected.checkpointSequence) ||
        (envelope["reliableSequence"] ?? "0") !== String(expected.reliableSequence))
    )
      throw invalid();
    encodeWireMessage("unframe.realtime.DurableCheckpointEnvelope", {
      ...envelope,
      runtimeKind,
      canonicalSnapshotPayload: canonicalBytes,
      recoveryPayload: recoveryBytes,
    });
    if (
      !envelope["sessionId"] ||
      !envelope["runtimeId"] ||
      !envelope["publication"] ||
      BigInt(envelope["checkpointSequence"] as string) <= 0n ||
      BigInt(envelope["assignmentEpoch"] as string) <= 0n
    )
      throw invalid();
    if (
      envelope["canonicalSnapshotHash"] !== (await hash(canonicalBytes)) ||
      envelope["recoveryHash"] !== (await hash(recoveryBytes))
    )
      throw invalid();
    const canonical = decodeWireMessage(
      "unframe.realtime.CanonicalRuntimeSnapshot",
      canonicalBytes,
    );
    const recovery = decodeWireMessage("unframe.realtime.RuntimeRecoveryMetadata", recoveryBytes);
    const synchronization = recovery["inputSynchronization"] as Record<string, unknown>;
    const input = synchronization["inputContext"] as Record<string, unknown>;
    const progression = canonical["progression"] as Record<string, unknown>;
    if (
      canonical["reliableSequence"] !== envelope["reliableSequence"] ||
      BigInt((synchronization["reliableSequence"] as string | undefined) ?? "0") >
        BigInt((envelope["reliableSequence"] as string | undefined) ?? "0") ||
      input["inputEpoch"] !== canonical["inputEpoch"] ||
      input["groupId"] !== progression["currentGroupId"] ||
      input["stepId"] !== progression["currentStepId"] ||
      input["groupEntryEpoch"] !== progression["groupEntryEpoch"] ||
      input["stepEntryEpoch"] !== progression["stepEntryEpoch"]
    )
      throw invalid();
    return envelope;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw invalid();
  }
}
