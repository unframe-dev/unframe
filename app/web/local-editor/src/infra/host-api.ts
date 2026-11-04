import { createEditorSocket } from "./editor-socket";
import {
  type BuildJob,
  type PreviewRequest,
  type PatchRequest,
  type ProjectSnapshot,
  type SavedCommand,
  type LocalPreviewEnvelopeWire,
  authorPublicationResultSchema,
  editorSessionSchema,
  projectChangeSchema,
  projectSnapshotSchema,
  buildJobSchema,
  savedCommandSchema,
  publicationAuthSchema,
} from "@unframe-dev/contracts/author-http";
import { encodeWireMessage } from "@unframe-dev/contracts/presentation";
import { z } from "zod";
export type { PublicationAuth } from "@unframe-dev/contracts/author-http";
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
export async function getEditorToken(): Promise<string> {
  const response = await fetch("/api/editor-session", {
    method: "POST",
    headers: { "x-unframe-editor": "1" },
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HostApiError(
      response.status,
      "editor-session-unavailable",
      "Editor connection failed.",
    );
  return editorSessionSchema.parse(await response.json()).token;
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
    projectChanges: (cursor?: string, signal?: AbortSignal) =>
      request(
        `/api/project/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        (value) => projectChangeSchema.parse(value),
        signal,
      ),
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
    ...createEditorSocket(token, options.baseUrl),
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
