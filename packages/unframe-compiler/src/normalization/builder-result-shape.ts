export type BuilderResultShape =
  | {
      readonly kind: "object";
      readonly objectArgument: 0;
      readonly objectArgumentOptional?: true;
      readonly resultKind: string;
    }
  | { readonly kind: "identity"; readonly objectArgument: 0 }
  | {
      readonly fields: ReadonlyArray<{
        readonly key: string;
        readonly argument: number;
        readonly valueType: "string" | "number";
      }>;
      readonly kind: "positional";
      readonly resultKind: string;
      readonly spreadObjectArgument?: number;
    };

const objectResults = new Map<string, string>([
  ["stringProp", "string"],
  ["editableText", "string"],
  ["numberProp", "number"],
  ["booleanProp", "boolean"],
  ["propRef", "prop-ref"],
  ["slot", "slot"],
  ["slotPlaceholder", "slot-placeholder"],
  ["part", "part"],
  ["variant", "variant"],
  ["state", "state"],
  ["action", "action"],
  ["output", "output"],
  ["invokeComponentAction", "component.action"],
  ["componentOutput", "component.output"],
  ["tokenRef", "token-ref"],
  ["namedStyleRef", "named-style-ref"],
  ["assetRef", "asset-ref"],
  ["spatial", "spatial"],
  ["frame", "frame"],
  ["text", "text"],
  ["surface", "surface"],
  ["semanticOverride", "semantic-override"],
  ["componentInstance", "component-instance"],
  ["detach", "detach"],
]);

const positionalResults = new Map<
  string,
  Omit<Extract<BuilderResultShape, { kind: "positional" }>, "kind">
>([
  [
    "setState",
    { fields: [{ argument: 0, key: "stateId", valueType: "string" }], resultKind: "setState" },
  ],
  [
    "prop",
    {
      fields: [{ argument: 0, key: "name", valueType: "string" }],
      resultKind: "prop-ref",
    },
  ],
  [
    "surfaceState",
    {
      fields: [
        { argument: 0, key: "surfaceId", valueType: "string" },
        { argument: 1, key: "stateId", valueType: "string" },
      ],
      resultKind: "surfaceState",
    },
  ],
  [
    "setSurfaceState",
    {
      fields: [
        { argument: 0, key: "surfaceId", valueType: "string" },
        { argument: 1, key: "stateId", valueType: "string" },
      ],
      resultKind: "setSurfaceState",
    },
  ],
  [
    "playTimeline",
    {
      fields: [{ argument: 0, key: "timelineId", valueType: "string" }],
      resultKind: "playTimeline",
      spreadObjectArgument: 1,
    },
  ],
  [
    "surfaceInteraction",
    {
      fields: [{ argument: 0, key: "interactionId", valueType: "string" }],
      resultKind: "surfaceInteraction",
    },
  ],
  [
    "timelineCompleted",
    {
      fields: [{ argument: 0, key: "timelineId", valueType: "string" }],
      resultKind: "timelineCompleted",
    },
  ],
  [
    "mediaCompleted",
    {
      fields: [{ argument: 0, key: "surfaceId", valueType: "string" }],
      resultKind: "mediaCompleted",
    },
  ],
  [
    "after",
    {
      fields: [{ argument: 0, key: "afterMilliseconds", valueType: "number" }],
      resultKind: "timer",
    },
  ],
]);

const identityBuilders = new Set([
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
  "cue",
]);

export const builderResultShape = (builder: string): BuilderResultShape | undefined => {
  const objectResult = objectResults.get(builder);
  if (objectResult) {
    return {
      kind: "object",
      objectArgument: 0,
      resultKind: objectResult,
      ...(builder === "state" ? { objectArgumentOptional: true as const } : {}),
    };
  }
  if (identityBuilders.has(builder)) {
    return { kind: "identity", objectArgument: 0 };
  }
  const positional = positionalResults.get(builder);
  return positional ? { kind: "positional", ...positional } : undefined;
};
