import { z } from "zod";

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
      instanceId: z.string().min(1),
      kind: z.literal("setProp"),
      propId: z.string().min(1),
      value: z.union([z.string(), z.number().finite(), z.boolean()]),
    })
    .strict(),
  z
    .object({
      instanceId: z.string().min(1),
      kind: z.literal("setTransform"),
      transform: transformSchema,
    })
    .strict(),
]);
export const randomIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const patchRequestSchema = z
  .object({
    command: editCommandSchema,
    commandId: randomIdSchema,
    expectedIrHash: z.string().min(1),
  })
  .strict();
export const buildRequestSchema = z.object({ requestId: randomIdSchema }).strict();
export type EditCommand = z.infer<typeof editCommandSchema>;
export type PatchRequest = z.infer<typeof patchRequestSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type AuthorDiagnostic = {
  code: string;
  message: string;
  path?: ReadonlyArray<string | number>;
};
export type AuthorInstance = {
  instanceId: string;
  props: Record<
    string,
    { editable: boolean; type: "string" | "number" | "boolean"; value: string | number | boolean }
  >;
  transform: Transform;
  transformEditable: boolean;
};
export type ProjectSnapshot = {
  diagnostics: Array<AuthorDiagnostic>;
  instances: Array<AuthorInstance>;
  irHash: string | null;
  revision: string;
  sourceHash: string;
};
export type SavedCommand = {
  commandId: string;
  irHash: string;
  revision: string;
  sourceHash: string;
};
export type BuildJob = {
  artifacts: Array<{ assetId: string; instanceId: string; mediaType: string }>;
  buildId: string;
  diagnostics: Array<AuthorDiagnostic>;
  revision: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";
};
export class AuthorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Array<{ path: string; reason: string }> = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}
export type AuthorService = {
  artifact(buildId: string, assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  build(revision: string, requestId: string): Promise<BuildJob>;
  cancel(buildId: string): Promise<BuildJob>;
  close(): Promise<void>;
  job(buildId: string): Promise<BuildJob>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  project(): Promise<ProjectSnapshot>;
};
