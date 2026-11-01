import {
  type BuildJob,
  type PreviewRequest,
  type PreviewPlaybackCommand,
  type PreviewPlaybackResponse,
  type PatchRequest,
  type ProjectSnapshot,
  type SavedCommand,
  type LocalPreviewEnvelopeWire,
  authorPublicationResultSchema,
  projectSnapshotSchema,
  buildJobSchema,
  savedCommandSchema,
  publicationAuthSchema,
  previewPlaybackResponseSchema,
} from "@unframe/contracts/author-http";
import { encodeWireMessage } from "@unframe/contracts/presentation";
import { z } from "zod";
export type { PublicationAuth } from "@unframe/contracts/author-http";
const text = z.string().min(1);
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
      request(
        "/api/project",
        (value) => projectSnapshotSchema.parse(value) as ProjectSnapshot,
        signal,
      ),
    patch: (revision: string, body: PatchRequest, signal?: AbortSignal) =>
      request(
        "/api/project",
        (value) => savedCommandSchema.parse(value) as SavedCommand,
        signal,
        write("PATCH", body, revision),
      ),
    build: (revision: string, requestId: string, signal?: AbortSignal) =>
      request(
        "/api/builds",
        (value) => buildJobSchema.parse(value) as BuildJob,
        signal,
        write("POST", { requestId }, revision),
      ),
    distBuild: (revision: string, requestId: string, signal?: AbortSignal) =>
      request(
        "/api/dist-builds",
        (value) => buildJobSchema.parse(value) as BuildJob,
        signal,
        write("POST", { requestId }, revision),
      ),
    preview: (body: PreviewRequest, signal?: AbortSignal) =>
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
          const result = previewPlaybackResponseSchema.parse(value);
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
      request("/api/publication-auth", (value) => publicationAuthSchema.parse(value), signal),
    beginPublicationAuth: (signal?: AbortSignal) =>
      request(
        "/api/publication-auth",
        (value) => publicationAuthSchema.parse(value),
        signal,
        write("POST"),
      ),
    cancelPublicationAuth: (signal?: AbortSignal) =>
      request("/api/publication-auth", empty, signal, write("DELETE")),
    publish: (requestId: string, signal?: AbortSignal) =>
      request(
        "/api/publications",
        (value) => authorPublicationResultSchema.parse(value),
        signal,
        write("POST", { requestId }),
      ),
    publicationStatus: (requestId: string, signal?: AbortSignal) =>
      request(
        "/api/publication-status",
        (value) => authorPublicationResultSchema.parse(value),
        signal,
        write("POST", { requestId }),
      ),
    job: (buildId: string, signal?: AbortSignal) =>
      request(
        `/api/builds/${encodeURIComponent(buildId)}`,
        (value) => buildJobSchema.parse(value) as BuildJob,
        signal,
      ),
    cancel: (buildId: string, signal?: AbortSignal) =>
      request(
        `/api/builds/${encodeURIComponent(buildId)}/cancellation`,
        (value) => buildJobSchema.parse(value) as BuildJob,
        signal,
        write("PUT"),
      ),
  };
}
export type HostApi = ReturnType<typeof createHostApi>;
