export type BuilderResultShape =
  | {
      readonly kind: "object";
      readonly resultKind: string;
      readonly objectArgument: 0;
      readonly objectArgumentOptional?: true;
    }
  | { readonly kind: "identity"; readonly objectArgument: 0 }
  | {
      readonly kind: "positional";
      readonly resultKind: string;
      readonly fields: readonly {
        readonly key: string;
        readonly argument: number;
        readonly valueType: "string" | "number";
      }[];
      readonly spreadObjectArgument?: number;
    };

const objectResults = new Map<string, string>([
  ["stringProp", "string"],
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
    "surfaceState",
    {
      resultKind: "surfaceState",
      fields: [
        { key: "surfaceId", argument: 0, valueType: "string" },
        { key: "stateId", argument: 1, valueType: "string" },
      ],
    },
  ],
  [
    "setSurfaceState",
    {
      resultKind: "setSurfaceState",
      fields: [
        { key: "surfaceId", argument: 0, valueType: "string" },
        { key: "stateId", argument: 1, valueType: "string" },
      ],
    },
  ],
  [
    "playTimeline",
    {
      resultKind: "playTimeline",
      fields: [{ key: "timelineId", argument: 0, valueType: "string" }],
      spreadObjectArgument: 1,
    },
  ],
  [
    "surfaceInteraction",
    {
      resultKind: "surfaceInteraction",
      fields: [{ key: "interactionId", argument: 0, valueType: "string" }],
    },
  ],
  [
    "timelineCompleted",
    {
      resultKind: "timelineCompleted",
      fields: [{ key: "timelineId", argument: 0, valueType: "string" }],
    },
  ],
  [
    "mediaCompleted",
    {
      resultKind: "mediaCompleted",
      fields: [{ key: "surfaceId", argument: 0, valueType: "string" }],
    },
  ],
  [
    "after",
    {
      resultKind: "timer",
      fields: [{ key: "afterMilliseconds", argument: 0, valueType: "number" }],
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
  if (objectResult)
    return {
      kind: "object",
      resultKind: objectResult,
      objectArgument: 0,
      ...(builder === "state" ? { objectArgumentOptional: true as const } : {}),
    };
  if (identityBuilders.has(builder)) return { kind: "identity", objectArgument: 0 };
  const positional = positionalResults.get(builder);
  return positional ? { kind: "positional", ...positional } : undefined;
};
