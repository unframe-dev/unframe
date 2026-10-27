import type { paths } from "@unframe/contracts/control-plane";
import { z } from "zod";
import { AudienceConnectionError, createAudienceHttpClient } from "./http-client";

type ViewerCredential =
  paths["/viewer-credentials"]["post"]["responses"][201]["content"]["application/json"];
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const credentialSchema: z.ZodType<ViewerCredential> = z.object({
  token: z
    .string()
    .min(1)
    .max(16384)
    .regex(/^viewer_[A-Za-z0-9_-]+$/),
  expiresAt: z.iso.datetime(),
  sessionId: identifier,
  participantId: identifier,
});

export function createAnonymousAudienceClient(
  config: { apiOrigin: string; capabilityProfileId: string },
  options: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let credential: ViewerCredential | null = null;
  let generation = 0;
  let refreshing: Promise<void> | null = null;
  const client = createAudienceHttpClient(config, {
    ...options,
    authorization: () => credential?.token ?? null,
  });
  const origin = new URL(config.apiOrigin).origin;
  async function request(
    path: string,
    method: string,
    token: string | null,
    body?: object,
    signal?: AbortSignal,
  ) {
    let response: Response;
    try {
      response = await requestFetch(`${origin}${path}`, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new AudienceConnectionError(signal?.aborted ? "aborted" : "network-error");
    }
    if (response.status !== (method === "DELETE" ? 204 : path.endsWith("refresh") ? 200 : 201))
      throw new AudienceConnectionError("http-error", response.status);
    return response;
  }
  async function read(response: Response): Promise<ViewerCredential> {
    try {
      if (
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
      )
        throw new Error();
      const result = credentialSchema.parse(await response.json());
      if (Date.parse(result.expiresAt) <= now()) throw new Error();
      return result;
    } catch {
      throw new AudienceConnectionError("invalid-response");
    }
  }
  async function revoke(value: ViewerCredential) {
    await request("/viewer-credentials", "DELETE", value.token);
  }
  async function ensure(id: string) {
    if (!credential || credential.sessionId !== id || Date.parse(credential.expiresAt) <= now())
      throw new AudienceConnectionError("unauthorized");
    if (Date.parse(credential.expiresAt) - now() > 5 * 60000) return;
    if (!refreshing) {
      const old = credential;
      const token = generation;
      const work = (async () => {
        const next = await read(await request("/viewer-credentials/refresh", "POST", old.token));
        if (generation !== token || credential !== old) {
          await revoke(next).catch(() => {});
          throw new AudienceConnectionError("aborted");
        }
        if (next.sessionId !== old.sessionId || next.participantId !== old.participantId)
          throw new AudienceConnectionError("invalid-response");
        credential = next;
      })();
      refreshing = work;
      void work
        .finally(() => {
          if (refreshing === work) refreshing = null;
        })
        .catch(() => {});
    }
    await refreshing;
  }
  async function leave() {
    generation++;
    const previous = credential;
    credential = null;
    refreshing = null;
    if (previous) await revoke(previous);
  }
  return {
    async join(joinCode: string, signal?: AbortSignal) {
      if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(joinCode))
        throw new AudienceConnectionError("invalid-join-code");
      const leaving = leave();
      const token = generation;
      await leaving.catch(() => {});
      if (token !== generation || signal?.aborted) throw new AudienceConnectionError("aborted");
      const issued = await read(
        await request("/viewer-credentials", "POST", null, { joinCode }, signal),
      );
      if (token !== generation || signal?.aborted) {
        await revoke(issued).catch(() => {});
        throw new AudienceConnectionError("aborted");
      }
      credential = issued;
      try {
        const session = await client.join(joinCode, signal);
        if (session.id !== issued.sessionId) throw new AudienceConnectionError("invalid-response");
        return session;
      } catch (error) {
        if (credential === issued) {
          credential = null;
          await revoke(issued).catch(() => {});
        }
        throw error;
      }
    },
    async delivery(id: string, signal?: AbortSignal) {
      await ensure(id);
      return client.delivery(id, signal);
    },
    async bootstrap(id: string, signal?: AbortSignal) {
      await ensure(id);
      return client.bootstrap(id, signal);
    },
    leave,
  };
}
