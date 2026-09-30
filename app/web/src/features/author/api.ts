import type {
  BuildJob,
  PatchRequest,
  ProjectSnapshot,
  SavedCommand,
} from "../../../../../packages/unframe-cli/src/author/contract";

export function takeAuthorToken(): string | null {
  const fragment = location.hash;
  history.replaceState(history.state, "", location.pathname + location.search);
  const token = new URLSearchParams(fragment.slice(1)).get("token");
  return token && /^[0-9a-f]{64}$/i.test(token) ? token : null;
}

export class AuthorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createAuthorApi(token: string) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      throw new AuthorApiError(
        response.status,
        typeof record["code"] === "string" ? record["code"] : "http-error",
        typeof record["message"] === "string" ? record["message"] : `HTTP ${response.status}`,
      );
    }
    return response.json() as Promise<T>;
  }
  const json = (body: unknown) => JSON.stringify(body);
  const write = (
    method: "PATCH" | "POST" | "PUT",
    revision?: string,
    body?: unknown,
  ): RequestInit => ({
    body: json(body ?? {}),
    headers: {
      "Content-Type": "application/json",
      ...(revision ? { "If-Match": JSON.stringify(revision) } : {}),
    },
    method,
  });
  return {
    artifact: async (buildId: string, assetId: string) => {
      const response = await fetch(
        `/api/builds/${encodeURIComponent(buildId)}/artifacts/${encodeURIComponent(assetId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new AuthorApiError(
          response.status,
          "artifact-failed",
          `Preview HTTP ${response.status}`,
        );
      }
      return response.blob();
    },
    build: (revision: string, requestId: string) =>
      request<BuildJob>("/api/builds", write("POST", revision, { requestId })),
    cancel: (buildId: string) =>
      request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}/cancellation`, write("PUT")),
    job: (buildId: string) => request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}`),
    patch: (revision: string, body: PatchRequest) =>
      request<SavedCommand>("/api/project", write("PATCH", revision, body)),
    project: () => request<ProjectSnapshot>("/api/project"),
  };
}

export type AuthorApi = ReturnType<typeof createAuthorApi>;
