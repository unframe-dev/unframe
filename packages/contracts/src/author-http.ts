import { z } from "zod";
import {
  presentationDefinitionSchema,
  type PresentationDefinition,
} from "./presentation/definition";
import type { LocalPreviewPlaybackStateWire } from "../presentation/wire-types";

const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const transformSchema = z
  .object({
    position: vector3,
    rotation: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    scale: vector3,
  })
  .strict();
export const editCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("setProp"),
      instanceId: z.string().min(1),
      propId: z.string().min(1),
      value: z.union([z.string(), z.number().finite(), z.boolean()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("setTransform"),
      instanceId: z.string().min(1),
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("inheritProp"),
      instanceId: z.string().min(1),
      propId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("restoreProp"),
      instanceId: z.string().min(1),
      propId: z.string().min(1),
      expression: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("inheritTransform"), instanceId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("restoreTransform"),
      instanceId: z.string().min(1),
      expression: z.string().min(1),
    })
    .strict(),
]);
export const randomIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const patchRequestSchema = z
  .object({
    commandId: randomIdSchema,
    expectedIrHash: z.string().min(1),
    command: editCommandSchema,
  })
  .strict();
export const buildRequestSchema = z.object({ requestId: randomIdSchema }).strict();

export const previewRequestSchema = z.discriminatedUnion("channel", [
  z.object({ requestId: randomIdSchema, channel: z.literal("dist") }).strict(),
  z
    .object({ requestId: randomIdSchema, channel: z.literal("dev"), buildId: randomIdSchema })
    .strict(),
]);
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const previewLoadRequestSchema = z.discriminatedUnion("channel", [
  z.object({ requestId: randomIdSchema, channel: z.literal("dist") }).strict(),
  z
    .object({
      requestId: randomIdSchema,
      channel: z.literal("dev"),
      generationId: randomIdSchema,
      sourceRevision: z.string().min(1).max(256),
    })
    .strict(),
]);
export const previewCommittedRequestSchema = z
  .object({
    requestId: randomIdSchema,
    buildIdentity: z.string().min(1),
  })
  .strict();
export const previewPlaybackCommandSchema = z.discriminatedUnion("command", [
  z
    .object({ requestId: randomIdSchema, command: z.enum(["poll", "play", "pause", "reset"]) })
    .strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.literal("inspectCue"),
      occurrenceId: z.string().min(1),
      inspectionId: randomIdSchema,
    })
    .strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.literal("seekCue"),
      inspectionId: randomIdSchema,
      timeMilliseconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.literal("leaveInspection"),
      inspectionId: randomIdSchema,
    })
    .strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.enum(["applied", "recover"]),
      sequence: z.string().regex(/^[1-9][0-9]*$/),
    })
    .strict(),
  z.object({ requestId: randomIdSchema, command: z.literal("invalidateDisplay") }).strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.literal("input"),
      cueId: z.string().min(1).max(1024),
    })
    .strict(),
]);

const text = z.string().min(1);
export const authorDiagnosticSchema = z
  .object({
    phase: z.enum(["config", "resolve", "transform"]).optional(),
    severity: z.enum(["warning", "error"]).optional(),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    plugin: z.string().optional(),
    code: text,
    message: z.string(),
    family: z.enum(["syntax", "type", "semantic", "renderer", "io", "cancel", "usage"]).optional(),
    path: z.array(z.union([z.string(), z.number().finite()])).optional(),
    location: z
      .object({
        fileName: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        line: z.number().int().nonnegative(),
        column: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .passthrough();
const prop = z.object({
  type: z.enum(["string", "number", "boolean"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
  editable: z.boolean(),
  inherited: z.boolean().optional(),
  inheritanceExpression: z.string().optional(),
  editor: z.object({ kind: z.literal("text") }).optional(),
});
export const projectSnapshotSchema: z.ZodType<ProjectSnapshot> = z.object({
  revision: text,
  sourceHash: text,
  irHash: text.nullable(),
  definition: presentationDefinitionSchema.nullable(),
  instances: z.array(
    z.object({
      instanceId: text,
      surfaceId: text,
      props: z.record(z.string(), prop),
      transform: transformSchema,
      transformEditable: z.boolean(),
      transformInherited: z.boolean().optional(),
      transformInheritanceExpression: z.string().optional(),
    }),
  ),
  diagnostics: z.array(authorDiagnosticSchema),
});
export const buildJobSchema = z.object({
  buildId: text,
  channel: z.enum(["dev", "dist"]),
  revision: text,
  generationId: text.nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "stale"]),
  diagnostics: z.array(authorDiagnosticSchema),
  artifacts: z.array(z.object({ assetId: text, mediaType: text, instanceId: text, stateId: text })),
});
export const savedCommandSchema = z.object({
  revision: text,
  sourceHash: text,
  irHash: text,
  commandId: text,
});
export const publicationAuthSchema = z.object({
  status: z.enum(["unconfigured", "signed-out", "pending", "authenticated", "denied", "expired"]),
  userCode: z.string().optional(),
  verificationUrl: z
    .url()
    .refine((value) => ["https:", "http:"].includes(new URL(value).protocol))
    .optional(),
  expiresAt: z.number().finite().optional(),
});
export type PublicationAuth = z.infer<typeof publicationAuthSchema>;
export const previewPlaybackResponseSchema = z
  .object({
    state: z.object({ requestId: text, sequence: z.string().regex(/^\d+$/) }).passthrough(),
    inputs: z.array(z.object({ cueId: text, label: z.string() })),
    groupId: z.string(),
    stepId: z.string(),
    ended: z.boolean(),
    mode: z.enum(["normal", "inspection"]),
    inspection: z
      .object({
        inspectionId: text,
        occurrenceId: text,
        timeMilliseconds: z.number().int().nonnegative().safe(),
        durationMilliseconds: z.number().int().nonnegative().safe(),
      })
      .nullable(),
    occurrences: z.array(
      z.object({
        occurrenceId: text,
        groupId: text,
        stepId: text,
        cueId: text,
        groupEntryEpoch: z.number().int().nonnegative(),
        stepEntryEpoch: z.number().int().nonnegative(),
        runtimeTimeMilliseconds: z.number().int().nonnegative().safe(),
        durationMilliseconds: z.number().int().nonnegative().safe(),
      }),
    ),
  })
  .passthrough();

export type EditCommand = z.infer<typeof editCommandSchema>;
export type PatchRequest = z.infer<typeof patchRequestSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type AuthorDiagnostic = z.infer<typeof authorDiagnosticSchema>;
export type AuthorInstance = {
  instanceId: string;
  surfaceId: string;
  props: Record<
    string,
    {
      type: "string" | "number" | "boolean";
      value: string | number | boolean;
      editable: boolean;
      inherited?: boolean | undefined;
      inheritanceExpression?: string | undefined;
      editor?: { kind: "text" } | undefined;
    }
  >;
  transform: Transform;
  transformEditable: boolean;
  transformInherited?: boolean | undefined;
  transformInheritanceExpression?: string | undefined;
};
export type ProjectSnapshot = {
  revision: string;
  sourceHash: string;
  irHash: string | null;
  definition: PresentationDefinition | null;
  instances: AuthorInstance[];
  diagnostics: AuthorDiagnostic[];
};
export type SavedCommand = z.infer<typeof savedCommandSchema>;
export type BuildJob = z.infer<typeof buildJobSchema>;
export type PreviewPlaybackCommand = z.infer<typeof previewPlaybackCommandSchema>;
export type PreviewLoadRequest = z.infer<typeof previewLoadRequestSchema>;
export type PreviewCommittedRequest = z.infer<typeof previewCommittedRequestSchema>;
export type CueOccurrence = z.infer<typeof previewPlaybackResponseSchema>["occurrences"][number];
export type PreviewPlaybackResponse = {
  [K in "mode" | "inspection" | "occurrences" | "inputs" | "groupId" | "stepId" | "ended"]: z.infer<
    typeof previewPlaybackResponseSchema
  >[K];
} & { state: LocalPreviewPlaybackStateWire };
export type { LocalPreviewEnvelopeWire } from "../presentation/wire-types";

export const publicationOperationSchema = z.object({
  presentationId: text,
  buildId: text,
  publicationEpoch: z.number().int().positive().safe(),
  definitionHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  renderBundleHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  assetSetHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export const authorPublicationResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    buildId: text,
    publicationEpoch: z.number().int().positive().safe(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.literal("cli-publish-outcome-unknown"),
    outcome: z.literal("outcome-unknown"),
    operation: publicationOperationSchema,
  }),
]);
export type AuthorPublicationResult = z.infer<typeof authorPublicationResultSchema>;
