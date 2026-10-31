import type {
  BuildJob,
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
  PatchRequest,
  ProjectSnapshot,
  SavedCommand,
  LocalPreviewEnvelopeWire,
} from "@unframe/core/cli/author-contract";
import { encodeWireMessage, presentationDefinitionSchema } from "@unframe/contracts/presentation";
import { z } from "zod";

const text = z.string().min(1);
const diagnostic = z
  .object({
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
const transform = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  rotation: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  scale: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
});
const prop = z.object({
  type: z.enum(["string", "number", "boolean"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
  editable: z.boolean(),
  inherited: z.boolean().optional(),
  inheritanceExpression: z.string().optional(),
  editor: z.object({ kind: z.literal("text") }).optional(),
});
const projectSchema = z.object({
  revision: text,
  sourceHash: text,
  irHash: text.nullable(),
  definition: presentationDefinitionSchema.nullable(),
  instances: z.array(
    z.object({
      instanceId: text,
      surfaceId: text,
      props: z.record(z.string(), prop),
      transform,
      transformEditable: z.boolean(),
      transformInherited: z.boolean().optional(),
      transformInheritanceExpression: z.string().optional(),
    }),
  ),
  diagnostics: z.array(diagnostic),
});
const jobSchema = z.object({
  buildId: text,
  channel: z.enum(["dev", "dist"]),
  revision: text,
  generationId: text.nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "stale"]),
  diagnostics: z.array(diagnostic),
  artifacts: z.array(z.object({ assetId: text, mediaType: text, instanceId: text, stateId: text })),
});
const savedSchema = z.object({ revision: text, sourceHash: text, irHash: text, commandId: text });
const authSchema = z.object({
  status: z.enum(["unconfigured", "signed-out", "pending", "authenticated", "denied", "expired"]),
  userCode: z.string().optional(),
  verificationUrl: z
    .url()
    .refine((value) => ["https:", "http:"].includes(new URL(value).protocol))
    .optional(),
  expiresAt: z.number().finite().optional(),
});
export type PublicationAuth = z.infer<typeof authSchema>;
const responseSchema = z
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
export class HostApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function takeEditorToken(): string | null {
  const fragment = location.hash;
  history.replaceState(history.state, "", location.pathname + location.search);
  const token = new URLSearchParams(fragment.slice(1)).get("token");
  return token && /^[0-9a-f]{64}$/i.test(token) ? token : null;
}
export function createHostApi(
  token: string,
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
) {
  const transport = options.fetch ?? fetch;
  async function request<T>(
    path: string,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await transport(`${options.baseUrl ?? ""}${path}`, {
      ...init,
      signal: signal ?? null,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = z.object({ code: z.string(), message: z.string() }).safeParse(body);
      throw new HostApiError(
        response.status,
        error.success ? error.data.code : "http-error",
        error.success ? error.data.message : `HTTP ${response.status}`,
      );
    }
    try {
      return parse(response.status === 204 ? undefined : await response.json());
    } catch (error) {
      throw new HostApiError(
        response.status,
        "invalid-response",
        `Host応答が契約に一致しません: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const write = (method: string, body: unknown = {}, revision?: string): RequestInit => ({
    method,
    headers: {
      "Content-Type": "application/json",
      ...(revision ? { "If-Match": JSON.stringify(revision) } : {}),
    },
    body: JSON.stringify(body),
  });
  const empty = (value: unknown) => {
    if (value !== undefined) throw new Error("Expected no content.");
  };
  return {
    project: (signal?: AbortSignal) =>
      request("/api/project", (value) => projectSchema.parse(value) as ProjectSnapshot, signal),
    patch: (revision: string, body: PatchRequest, signal?: AbortSignal) =>
      request(
        "/api/project",
        (value) => savedSchema.parse(value) as SavedCommand,
        signal,
        write("PATCH", body, revision),
      ),
    build: (revision: string, requestId: string, signal?: AbortSignal) =>
      request(
        "/api/builds",
        (value) => jobSchema.parse(value) as BuildJob,
        signal,
        write("POST", { requestId }, revision),
      ),
    distBuild: (revision: string, requestId: string, signal?: AbortSignal) =>
      request(
        "/api/dist-builds",
        (value) => jobSchema.parse(value) as BuildJob,
        signal,
        write("POST", { requestId }, revision),
      ),
    preview: (
      body:
        | { requestId: string; channel: "dist" }
        | { requestId: string; channel: "dev"; generationId: string; sourceRevision: string },
      signal?: AbortSignal,
    ) =>
      request(
        "/api/previews",
        (value) => {
          const envelope = z
            .object({ requestId: text, buildManifest: text })
            .passthrough()
            .parse(value);
          encodeWireMessage("unframe.preview.LocalPreviewEnvelope", envelope);
          return envelope as LocalPreviewEnvelopeWire;
        },
        signal,
        write("POST", body),
      ),
    playback: (body: PreviewPlaybackCommand, signal?: AbortSignal) =>
      request(
        "/api/preview-playback",
        (value) => {
          const result = responseSchema.parse(value);
          encodeWireMessage("unframe.preview.LocalPreviewPlaybackState", result.state);
          return result as PreviewPlaybackResponse;
        },
        signal,
        write("POST", body),
      ),
    confirmDisplay: (requestId: string, buildIdentity: string, signal?: AbortSignal) =>
      request("/api/preview-display", empty, signal, write("POST", { requestId, buildIdentity })),
    invalidateDisplay: (signal?: AbortSignal) =>
      request("/api/preview-display", empty, signal, write("DELETE")),
    publicationAuth: (signal?: AbortSignal) =>
      request("/api/publication-auth", (value) => authSchema.parse(value), signal),
    beginPublicationAuth: (signal?: AbortSignal) =>
      request("/api/publication-auth", (value) => authSchema.parse(value), signal, write("POST")),
    cancelPublicationAuth: (signal?: AbortSignal) =>
      request("/api/publication-auth", empty, signal, write("DELETE")),
    publish: (requestId: string, signal?: AbortSignal) =>
      request(
        "/api/publications",
        (value) =>
          z
            .object({
              ok: z.literal(true),
              buildId: text,
              publicationEpoch: z.number().int().nonnegative().safe(),
            })
            .parse(value),
        signal,
        write("POST", { requestId }),
      ),
    job: (buildId: string, signal?: AbortSignal) =>
      request(
        `/api/builds/${encodeURIComponent(buildId)}`,
        (value) => jobSchema.parse(value) as BuildJob,
        signal,
      ),
    cancel: (buildId: string, signal?: AbortSignal) =>
      request(
        `/api/builds/${encodeURIComponent(buildId)}/cancellation`,
        (value) => jobSchema.parse(value) as BuildJob,
        signal,
        write("PUT"),
      ),
  };
}
export type HostApi = ReturnType<typeof createHostApi>;
