export const runtimeAuthorityVersions = Object.freeze({
  definition: 3,
  renderBundle: 2,
  assetSet: 2,
  buildManifest: 3,
  publication: 3,
  capability: 3,
  delivery: 3,
  protocol: "v3",
  runtime: 3,
  progression: 2,
  projection: 2,
  catalog: 3,
  snapshot: 3,
  checkpoint: 3,
  localPreview: 1,
} as const);

export const runtimeAuthorityLimits = Object.freeze({
  maximumControlItemBytes: 1_048_576,
  maximumStateItemBytes: 262_144,
  maximumCommandHistoryCount: 1_024,
  maximumCommandHistoryBytes: 262_144,
  commandHistorySyncCount: 1_000,
  commandHistorySyncBytes: 245_760,
  maximumCommandRecordBytes: 1_024,
  maximumCanonicalSnapshotBytes: 786_432,
  maximumStepStartHistoryBytes: 524_288,
  maximumStepStartStateBytes: 65_536,
  maximumRecoveryMetadataBytes: 262_144,
  maximumCheckpointJsonBytes: 1_572_864,
  maximumInputSynchronizationBytes: 4_096,
  zoneEdgeLengthMeters: 2,
} as const);

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const commandIdPattern =
  /^([1-9][0-9]*):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const normalCommands = new Set([
  "LogicalInputCommand",
  "SurfaceInteractionCommand",
  "GestureInputCommand",
  "ZoneInputCommand",
]);

function positiveInteger(value: unknown): boolean {
  return (
    typeof value === "string" && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= (1n << 64n) - 1n
  );
}

function identifier(value: unknown): boolean {
  return typeof value === "string" && idPattern.test(value);
}

function inputContext(value: unknown): void {
  if (typeof value !== "object" || value === null) throw new TypeError("Input context is required");
  const context = value as Record<string, unknown>;
  if (
    !identifier(context["groupId"]) ||
    !identifier(context["stepId"]) ||
    !positiveInteger(context["groupEntryEpoch"]) ||
    !positiveInteger(context["stepEntryEpoch"]) ||
    !positiveInteger(context["inputEpoch"])
  )
    throw new TypeError("Invalid input context");
}

export function validateAuthorityWireValue(typeName: string, value: Record<string, unknown>): void {
  const name = typeName.split(".").at(-1);
  if (
    name === "RuntimeCapacityFault" &&
    !["stepStartStateBytes", "stepStartHistoryBytes", "canonicalSnapshotBytes"].every((field) =>
      positiveInteger(value[field]),
    )
  )
    throw new TypeError("Runtime capacity fault requires attempted byte sizes");
  if (name === "PresenterStepSelectionCatalog") {
    let previous = "";
    for (const step of (value["reachedSteps"] ?? []) as Record<string, unknown>[]) {
      const groupId = step["groupId"];
      const stepId = step["stepId"];
      if (!identifier(groupId) || !identifier(stepId))
        throw new TypeError("Step selection requires Group and Step IDs");
      const key = `${groupId}\u0000${stepId}`;
      if (key <= previous) throw new TypeError("Reached Steps must be sorted and unique");
      previous = key;
    }
  }
  if (name === "ControlHandshake" || name === "ControlConnected" || name === "StateHandshake") {
    if (
      value["protocolVersion"] !== runtimeAuthorityVersions.protocol ||
      value["progressionContractVersion"] !== runtimeAuthorityVersions.progression
    )
      throw new TypeError("Runtime protocol is incompatible with Presenter authority");
    const capabilities =
      value[name === "ControlConnected" ? "requiredCapabilities" : "supportedCapabilities"];
    if (
      !Array.isArray(capabilities) ||
      ![8, 9, 10].every((capability) => capabilities.includes(capability))
    )
      throw new TypeError(
        "Runtime requires synchronization, frozen Anchor and Step restore capabilities",
      );
  }
  const schemaMajors: Readonly<Record<string, number>> = {
    CanonicalRuntimeSnapshot: 3,
    ConnectionSnapshotEnvelope: 3,
    DurableCheckpointEnvelope: 3,
    CapabilityProfile: 3,
    DeliveryManifest: 3,
  };
  if (name && schemaMajors[name] !== undefined && value["schemaVersion"] !== schemaMajors[name])
    throw new TypeError(`${name} schema major is incompatible`);
  if (name === "DeliveryManifest" && value["deliveryContractVersion"] !== 3)
    throw new TypeError("Delivery contract major is incompatible");
  if (name === "ProjectedRuntimeCatalog" && value["catalogContractVersion"] !== 3)
    throw new TypeError("Runtime catalog contract major is incompatible");
  if (name === "CanonicalRuntimeSnapshot" && !positiveInteger(value["inputEpoch"]))
    throw new TypeError("Canonical Snapshot requires a positive input epoch");
  if (
    name === "StepStartState" &&
    (!identifier(value["groupId"]) ||
      !identifier(value["stepId"]) ||
      !positiveInteger(value["groupEntryEpoch"]) ||
      !positiveInteger(value["stepEntryEpoch"]))
  )
    throw new TypeError("Step start state requires group and step identities and entry epochs");
  if (name === "ProjectionProfileKey" && value["projectionContractVersion"] !== 2)
    throw new TypeError("Projection contract major is incompatible");
  if (
    name === "ContractVersions" &&
    (value["delivery"] !== 3 ||
      value["runtime"] !== 3 ||
      value["progression"] !== 2 ||
      value["projection"] !== 2)
  )
    throw new TypeError("Delivery contract version combination is incompatible");
  if (name && (normalCommands.has(name) || name === "RuntimeControlCommand")) {
    const match =
      typeof value["clientEventId"] === "string"
        ? commandIdPattern.exec(value["clientEventId"])
        : null;
    if (!positiveInteger(value["commandEpoch"]) || !match || match[1] !== value["commandEpoch"])
      throw new TypeError("Command ID must bind its command epoch to a lowercase UUID v4");
    if (normalCommands.has(name)) inputContext(value["inputContext"]);
    if (name === "LogicalInputCommand" && !identifier(value["logicalEventName"]))
      throw new TypeError("Logical input name is required");
    if (
      name === "SurfaceInteractionCommand" &&
      (!identifier(value["surfaceId"]) || !identifier(value["interactionId"]))
    )
      throw new TypeError("Surface interaction target is required");
    if (
      name === "GestureInputCommand" &&
      (typeof value["gesture"] !== "number" || value["gesture"] < 1 || value["gesture"] > 8)
    )
      throw new TypeError("Gesture kind is required");
    if (
      name === "ZoneInputCommand" &&
      (!identifier(value["zoneId"]) || ![1, 2].includes(value["edge"] as number))
    )
      throw new TypeError("Zone ID and edge are required");
    if (name === "RuntimeControlCommand") {
      if (![1, 2, 3, 4, 5].includes(value["kind"] as number))
        throw new TypeError("Runtime control kind is required");
      const selection = value["stepSelection"] as Record<string, unknown> | undefined;
      if (
        (value["kind"] === 4) !== (selection !== undefined) ||
        (selection && (!identifier(selection["groupId"]) || !identifier(selection["stepId"])))
      )
        throw new TypeError("Only Step selection carries a group and step target");
    }
  }
  if (name === "InputContext") inputContext(value);
  if (name === "PresenterInputSynchronization" || name === "InputSynchronizationAck") {
    inputContext(value["inputContext"]);
    if (
      !positiveInteger(value["synchronizationRevision"]) ||
      !positiveInteger(value["commandEpoch"])
    )
      throw new TypeError("Input synchronization revision and command epoch are required");
    if (name === "InputSynchronizationAck" && value["pendingCommandsDiscarded"] !== true)
      throw new TypeError("Input synchronization requires pending commands to be discarded");
    if (name === "PresenterInputSynchronization") {
      if (typeof value["recognitionCatalog"] !== "object" || value["recognitionCatalog"] === null)
        throw new TypeError("Input synchronization requires a recognition catalog");
      if (
        ![1, 2].includes(value["phase"] as number) ||
        ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(value["reason"] as number)
      )
        throw new TypeError("Input synchronization phase and reason are required");
      if (
        value["nextCommandEpoch"] !== undefined &&
        (!positiveInteger(value["nextCommandEpoch"]) ||
          BigInt(value["nextCommandEpoch"] as string) !==
            BigInt(value["commandEpoch"] as string) + 1n)
      )
        throw new TypeError("Next command epoch must advance exactly once");
      if (value["phase"] === 2 && value["nextCommandEpoch"] !== undefined)
        throw new TypeError("Ready synchronization cannot contain a pending command epoch");
    }
  }
  if (
    name === "FrozenAnchorDisplayState" &&
    (!identifier(value["nodeId"]) ||
      (value["position"] === undefined && value["rotation"] === undefined))
  )
    throw new TypeError("Frozen Anchor requires a node and at least one display component");
  if (name === "RuntimeViewReplaced" && !value["runtimeView"])
    throw new TypeError("Atomic Runtime replacement requires a projected view");
  if (
    name === "ProjectedAnchorBindingPatch" &&
    value["frozen"] &&
    (value["frozen"] as Record<string, unknown>)["nodeId"] !== value["nodeId"]
  )
    throw new TypeError("Frozen Anchor node must match its binding");
  if (name === "RuntimeCommandHistory") {
    const match =
      typeof value["clientEventId"] === "string"
        ? commandIdPattern.exec(value["clientEventId"])
        : null;
    const outcome = value["outcome"] as Record<string, unknown> | undefined;
    if (
      !identifier(value["participantId"]) ||
      !positiveInteger(value["commandEpoch"]) ||
      !match ||
      match[1] !== value["commandEpoch"] ||
      !outcome ||
      outcome["clientEventId"] !== value["clientEventId"] ||
      typeof value["fingerprint"] !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(value["fingerprint"])
    )
      throw new TypeError("Invalid durable command record");
  }
  if (name === "RuntimeRecoveryMetadata") {
    const sync = value["inputSynchronization"] as Record<string, unknown> | undefined;
    const records = (value["commands"] ?? []) as Record<string, unknown>[];
    if (
      !positiveInteger(value["commandEpoch"]) ||
      !sync ||
      sync["commandEpoch"] !== value["commandEpoch"] ||
      typeof value["startedAt"] !== "string" ||
      !Number.isFinite(Date.parse(value["startedAt"])) ||
      !Array.isArray(value["participants"]) ||
      value["participants"].length === 0
    )
      throw new TypeError(
        "Recovery metadata requires a consistent command epoch and synchronization state",
      );
    const ids = new Set<string>();
    for (const record of records) {
      const key = `${record["participantId"]}\0${record["clientEventId"]}`;
      if (record["commandEpoch"] !== value["commandEpoch"] || ids.has(key))
        throw new TypeError("Recovery command epochs and keys must be consistent");
      ids.add(key);
    }
  }
}

export function assertRuntimeByteLength(typeName: string, length: number): void {
  const limits: Readonly<Record<string, number>> = {
    ControlClientItem: runtimeAuthorityLimits.maximumControlItemBytes,
    ControlServerItem: runtimeAuthorityLimits.maximumControlItemBytes,
    StateClientItem: runtimeAuthorityLimits.maximumStateItemBytes,
    StateServerItem: runtimeAuthorityLimits.maximumStateItemBytes,
    CanonicalRuntimeSnapshot: runtimeAuthorityLimits.maximumCanonicalSnapshotBytes,
    StepStartState: runtimeAuthorityLimits.maximumStepStartStateBytes,
    RuntimeRecoveryMetadata: runtimeAuthorityLimits.maximumRecoveryMetadataBytes,
    RuntimeCommandHistory: runtimeAuthorityLimits.maximumCommandRecordBytes,
    PresenterInputSynchronization: runtimeAuthorityLimits.maximumInputSynchronizationBytes,
    InputSynchronizationAck: runtimeAuthorityLimits.maximumInputSynchronizationBytes,
    CheckpointJson: runtimeAuthorityLimits.maximumCheckpointJsonBytes,
    StepStartHistory: runtimeAuthorityLimits.maximumStepStartHistoryBytes,
    CommandHistory: runtimeAuthorityLimits.maximumCommandHistoryBytes,
  };
  const limit = limits[typeName.split(".").at(-1)!];
  if (!Number.isSafeInteger(length) || length < 0 || (limit !== undefined && length > limit))
    throw new RangeError(`${typeName} exceeds its serialized byte limit`);
}
