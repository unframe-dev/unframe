import type {
  BuildJob,
  PatchRequest,
  ProjectSnapshot,
  SavedCommand,
  LocalPreviewEnvelopeWire,
} from "@unframe/unframe-cli/author-contract";

export type PublicationAuth = {
  status: "unconfigured" | "signed-out" | "pending" | "authenticated" | "denied" | "expired";
  userCode?: string;
  verificationUrl?: string;
  expiresAt?: number;
};

export function takeEditorToken(): string | null {
  const fragment = location.hash;
  history.replaceState(history.state, "", location.pathname + location.search);
  const token = new URLSearchParams(fragment.slice(1)).get("token");
  return token && /^[0-9a-f]{64}$/i.test(token) ? token : null;
}

export class EditorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createEditorApi(token: string) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      throw new EditorApiError(
        response.status,
        typeof record["code"] === "string" ? record["code"] : "http-error",
        typeof record["message"] === "string" ? record["message"] : `HTTP ${response.status}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  const json = (body: unknown) => JSON.stringify(body);
  const write = (
    method: "PATCH" | "POST" | "PUT" | "DELETE",
    revision?: string,
    body?: unknown,
  ): RequestInit => ({
    method,
    headers: {
      "Content-Type": "application/json",
      ...(revision ? { "If-Match": JSON.stringify(revision) } : {}),
    },
    body: json(body ?? {}),
  });
  return {
    project: () => request<ProjectSnapshot>("/api/project"),
    patch: (revision: string, body: PatchRequest) =>
      request<SavedCommand>("/api/project", write("PATCH", revision, body)),
    build: (revision: string, requestId: string) =>
      request<BuildJob>("/api/builds", write("POST", revision, { requestId })),
    distBuild: (revision: string, requestId: string) =>
      request<BuildJob>("/api/dist-builds", write("POST", revision, { requestId })),
    preview: (
      body:
        | { requestId: string; channel: "dist" }
        | { requestId: string; channel: "dev"; buildId: string },
    ) => request<LocalPreviewEnvelopeWire>("/api/previews", write("POST", undefined, body)),
    confirmDisplay: (requestId: string, buildIdentity: string) =>
      request<void>("/api/preview-display", write("POST", undefined, { requestId, buildIdentity })),
    invalidateDisplay: () => request<void>("/api/preview-display", write("DELETE")),
    publicationAuth: () => request<PublicationAuth>("/api/publication-auth"),
    beginPublicationAuth: () => request<PublicationAuth>("/api/publication-auth", write("POST")),
    cancelPublicationAuth: () => request<void>("/api/publication-auth", write("DELETE")),
    publish: (requestId: string) =>
      request<{ ok: true; buildId: string; publicationEpoch: number }>(
        "/api/publications",
        write("POST", undefined, { requestId }),
      ),
    job: (buildId: string) => request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}`),
    cancel: (buildId: string) =>
      request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}/cancellation`, write("PUT")),
  };
}

export type EditorApi = ReturnType<typeof createEditorApi>;
