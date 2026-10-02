import type {
  BuildJob,
  PatchRequest,
  ProjectSnapshot,
  SavedCommand,
} from "@unframe/unframe-cli/author-contract";

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
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
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
    job: (buildId: string) => request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}`),
    cancel: (buildId: string) =>
      request<BuildJob>(`/api/builds/${encodeURIComponent(buildId)}/cancellation`, write("PUT")),
    artifact: async (buildId: string, assetId: string) => {
      const response = await fetch(
        `/api/builds/${encodeURIComponent(buildId)}/artifacts/${encodeURIComponent(assetId)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok)
        throw new AuthorApiError(
          response.status,
          "artifact-failed",
          `Preview HTTP ${response.status}`,
        );
      return response.blob();
    },
  };
}

export type AuthorApi = ReturnType<typeof createAuthorApi>;
