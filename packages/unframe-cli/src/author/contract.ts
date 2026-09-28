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
export type EditCommand = z.infer<typeof editCommandSchema>;
export type PatchRequest = z.infer<typeof patchRequestSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type AuthorDiagnostic = {
  code: string;
  message: string;
  path?: readonly (string | number)[];
};
export type AuthorInstance = {
  instanceId: string;
  props: Record<
    string,
    { type: "string" | "number" | "boolean"; value: string | number | boolean; editable: boolean }
  >;
  transform: Transform;
  transformEditable: boolean;
};
export type ProjectSnapshot = {
  revision: string;
  sourceHash: string;
  irHash: string | null;
  instances: AuthorInstance[];
  diagnostics: AuthorDiagnostic[];
};
export type SavedCommand = {
  revision: string;
  sourceHash: string;
  irHash: string;
  commandId: string;
};
export type BuildJob = {
  buildId: string;
  revision: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";
  diagnostics: AuthorDiagnostic[];
  artifacts: { assetId: string; mediaType: string; instanceId: string }[];
};
export class AuthorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; reason: string }[] = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}
export type AuthorService = {
  project(): Promise<ProjectSnapshot>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  build(revision: string, requestId: string): Promise<BuildJob>;
  job(buildId: string): Promise<BuildJob>;
  cancel(buildId: string): Promise<BuildJob>;
  artifact(buildId: string, assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  close(): Promise<void>;
};
