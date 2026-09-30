import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quaternion = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(
    (value) => Math.abs(Math.hypot(...value) - 1) <= 0.0001,
    "rotation must be a normalized quaternion",
  )
  .describe("Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001.");
export const transformSchema = z
  .object({
    position: vector3,
    rotation: quaternion,
    scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  })
  .strict();
const initialState = z
  .object({
    active: z.boolean(),
    opacity: z.number().min(0).max(1),
    transform: transformSchema,
    visible: z.boolean(),
  })
  .strict();
const assetContent = z.object({ assetId: id }).strict();
const element = z.discriminatedUnion("type", [
  z
    .object({
      content: z.object({ text: z.string() }).strict(),
      id,
      initialState,
      type: z.literal("text"),
    })
    .strict(),
  z
    .object({
      content: z.object({ shape: z.enum(["cube", "sphere", "plane"]) }).strict(),
      id,
      initialState,
      type: z.literal("shape"),
    })
    .strict(),
  z.object({ content: assetContent, id, initialState, type: z.literal("image") }).strict(),
  z.object({ content: assetContent, id, initialState, type: z.literal("video") }).strict(),
  z.object({ content: assetContent, id, initialState, type: z.literal("model") }).strict(),
  z.object({ content: assetContent, id, initialState, type: z.literal("audio") }).strict(),
]);
const transition = z
  .object({ delaySeconds: z.number().min(0), durationSeconds: z.number().min(0) })
  .strict();
const action = z.discriminatedUnion("kind", [
  z
    .object({
      active: z.boolean(),
      kind: z.literal("setActive"),
      targetElementId: id,
      transition: transition.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("setVisible"),
      targetElementId: id,
      transition: transition.optional(),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("setOpacity"),
      opacity: z.number().min(0).max(1),
      targetElementId: id,
      transition: transition.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("setTransform"),
      targetElementId: id,
      transform: transformSchema,
      transition: transition.optional(),
    })
    .strict(),
]);
const trigger = z.discriminatedUnion("kind", [
  z.object({ action: z.string().min(1).max(128), kind: z.literal("button") }).strict(),
  z.object({ kind: z.literal("enterZone"), zoneId: id }).strict(),
  z.object({ kind: z.literal("motion"), minimumDistanceMeters: z.number().positive() }).strict(),
]);
const next = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("step"), stepId: id }).strict(),
  z.object({ groupId: id, kind: z.literal("group") }).strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);
const cue = z.object({ actions: z.array(action).min(1), id, next, trigger }).strict();
const step = z.object({ cues: z.array(cue).min(1), id }).strict();
const anchoredElementGroup = z
  .object({
    anchor: z.enum(["head", "leftHand", "rightHand", "body"]),
    elementIds: z.array(id).min(1),
    id,
    transform: transformSchema,
  })
  .strict();
const group = z
  .object({
    anchoredElementGroups: z.array(anchoredElementGroup),
    elements: z.array(element),
    id,
    steps: z.array(step).min(1),
  })
  .strict();

export const presentationDefinitionSchema = z
  .object({
    assets: z.array(z.object({ assetId: id }).strict()),
    groups: z.array(group).min(1),
    metadata: z
      .object({ description: z.string().max(4000).optional(), title: z.string().min(1).max(256) })
      .strict(),
    schemaVersion: z.literal(1),
    stage: z
      .object({
        coordinateSystem: z
          .object({
            forwardAxis: z.literal("-Z"),
            handedness: z.literal("right"),
            unit: z.literal("meter"),
            upAxis: z.literal("+Y"),
          })
          .strict(),
        size: vector3.refine(([x, y, z]) => x > 0 && y > 0 && z > 0, "stage size must be positive"),
        zones: z.array(
          z
            .object({
              bounds: z
                .object({ min: vector3, max: vector3 })
                .strict()
                .refine(
                  ({ min, max }) => min.every((value, index) => value < max[index]!),
                  "zone bounds min must be smaller than max",
                ),
              id,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, context) => {
    const issue = (path: Array<string | number>, message: string) =>
      context.addIssue({ code: "custom", message, path });
    const unique = (values: Array<string>, path: Array<string | number>, label: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          issue([...path, index], `duplicate ${label}: ${value}`);
        }
        seen.add(value);
      });
    };
    unique(
      definition.assets.map((asset) => asset.assetId),
      ["assets"],
      "asset id",
    );
    unique(
      definition.stage.zones.map((zone) => zone.id),
      ["stage", "zones"],
      "zone id",
    );
    unique(
      definition.groups.map((entry) => entry.id),
      ["groups"],
      "group id",
    );
    const assets = new Set(definition.assets.map((asset) => asset.assetId));
    const zones = new Set(definition.stage.zones.map((zone) => zone.id));
    const groups = new Set(definition.groups.map((entry) => entry.id));
    const elements = new Set<string>();
    definition.groups.forEach((entry, groupIndex) => {
      unique(
        entry.elements.map((value) => value.id),
        ["groups", groupIndex, "elements"],
        "element id",
      );
      unique(
        entry.anchoredElementGroups.map((value) => value.id),
        ["groups", groupIndex, "anchoredElementGroups"],
        "anchored element group id",
      );
      unique(
        entry.steps.map((value) => value.id),
        ["groups", groupIndex, "steps"],
        "step id",
      );
      entry.elements.forEach((value) => elements.add(value.id));
    });
    unique(
      definition.groups.flatMap((entry) => entry.elements.map((value) => value.id)),
      [],
      "element id",
    );
    definition.groups.forEach((entry, groupIndex) => {
      const stepIds = new Set(entry.steps.map((value) => value.id));
      entry.elements.forEach((value, elementIndex) => {
        if ("assetId" in value.content && !assets.has(value.content.assetId)) {
          issue(
            ["groups", groupIndex, "elements", elementIndex, "content", "assetId"],
            "unknown asset",
          );
        }
      });
      entry.anchoredElementGroups.forEach((anchor, anchorIndex) =>
        anchor.elementIds.forEach((elementId, elementIndex) => {
          if (!elements.has(elementId)) {
            issue(
              [
                "groups",
                groupIndex,
                "anchoredElementGroups",
                anchorIndex,
                "elementIds",
                elementIndex,
              ],
              "unknown element",
            );
          }
        }),
      );
      entry.steps.forEach((stepEntry, stepIndex) => {
        unique(
          stepEntry.cues.map((value) => value.id),
          ["groups", groupIndex, "steps", stepIndex, "cues"],
          "cue id",
        );
        stepEntry.cues.forEach((cueEntry, cueIndex) => {
          if (cueEntry.trigger.kind === "enterZone" && !zones.has(cueEntry.trigger.zoneId)) {
            issue(
              ["groups", groupIndex, "steps", stepIndex, "cues", cueIndex, "trigger", "zoneId"],
              "unknown zone",
            );
          }
          cueEntry.actions.forEach((actionEntry, actionIndex) => {
            if (!elements.has(actionEntry.targetElementId)) {
              issue(
                [
                  "groups",
                  groupIndex,
                  "steps",
                  stepIndex,
                  "cues",
                  cueIndex,
                  "actions",
                  actionIndex,
                  "targetElementId",
                ],
                "unknown element",
              );
            }
          });
          if (cueEntry.next.kind === "step" && !stepIds.has(cueEntry.next.stepId)) {
            issue(
              ["groups", groupIndex, "steps", stepIndex, "cues", cueIndex, "next", "stepId"],
              "next step must belong to this group",
            );
          }
          if (cueEntry.next.kind === "group" && !groups.has(cueEntry.next.groupId)) {
            issue(
              ["groups", groupIndex, "steps", stepIndex, "cues", cueIndex, "next", "groupId"],
              "unknown group",
            );
          }
        });
      });
    });
  })
  .describe(
    "Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries.",
  );

export const presentationCreateDefinitionSchema = presentationDefinitionSchema.and(
  z.object({ assets: z.array(z.object({ assetId: id }).strict()).max(0) }),
);

export type PresentationDefinition = z.infer<typeof presentationDefinitionSchema>;
