import {
  controlPlaneIdentifierSchema as identifier,
  sessionJoinCodeSchema,
  viewerCredentialSchema,
} from "@unframe/contracts/control-plane-http";
import { createControlPlaneClient } from "@unframe/api-client-typescript";
import type { paths } from "@unframe/contracts/control-plane";
import { z } from "zod";
import {
  AudienceConnectionError,
  audienceResponseError,
  createAudienceHttpClient,
} from "./http-client";

type ViewerCredential =
  paths["/viewer-credentials"]["post"]["responses"][201]["content"]["application/json"];
const credentialSchema: z.ZodType<ViewerCredential> = viewerCredentialSchema.extend({
  token: z
    .string()
    .min(1)
    .max(16384)
    .regex(/^viewer_[A-Za-z0-9_-]+$/),
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
    authorization: () => {
      if (!credential || Date.parse(credential.expiresAt) <= now())
        throw new AudienceConnectionError("unauthorized");
      return credential.token;
    },
  });
  const rpc = createControlPlaneClient({
    baseUrl: new URL(config.apiOrigin).origin,
    fetch: requestFetch,
    credentials: "omit",
  });
  type CredentialResponse = Pick<
    Response,
    "status" | "headers" | "redirected" | "json" | "arrayBuffer"
  >;
  async function request(
    send: (options: {
      init: RequestInit;
      headers: Record<string, string>;
    }) => Promise<CredentialResponse>,
    expectedStatus: number,
    token: string | null,
    signal?: AbortSignal,
  ) {
    let response: CredentialResponse;
    try {
      response = await send({
        init: {
          mode: "cors",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          ...(signal ? { signal } : {}),
        },
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new AudienceConnectionError(signal?.aborted ? "aborted" : "network-error");
    }
    if (response.status !== expectedStatus) throw await audienceResponseError(response);
    return response;
  }
  async function read(response: CredentialResponse): Promise<ViewerCredential> {
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
    await request((options) => rpc["viewer-credentials"].$delete({}, options), 204, value.token);
  }
  async function ensure(id: string) {
    if (!credential || credential.sessionId !== id || Date.parse(credential.expiresAt) <= now())
      throw new AudienceConnectionError("unauthorized");
    if (Date.parse(credential.expiresAt) - now() > 5 * 60000) return;
    if (!refreshing) {
      const old = credential;
      const token = generation;
      const work = (async () => {
        const next = await read(
          await request(
            (options) => rpc["viewer-credentials"].refresh.$post({}, options),
            200,
            old.token,
          ),
        );
        if (generation !== token || credential !== old) {
          await revoke(next).catch(() => {});
          throw new AudienceConnectionError("aborted");
        }
        if (Date.parse(old.expiresAt) <= now()) {
          credential = null;
          await revoke(next).catch(() => {});
          throw new AudienceConnectionError("unauthorized");
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
      if (!sessionJoinCodeSchema.safeParse(joinCode).success)
        throw new AudienceConnectionError("invalid-join-code");
      const leaving = leave();
      const token = generation;
      await leaving.catch(() => {});
      if (token !== generation || signal?.aborted) throw new AudienceConnectionError("aborted");
      const issued = await read(
        await request(
          (options) => rpc["viewer-credentials"].$post({ json: { joinCode } }, options),
          201,
          null,
          signal,
        ),
      );
      if (token !== generation || signal?.aborted) {
        await revoke(issued).catch(() => {});
        throw new AudienceConnectionError("aborted");
      }
      credential = issued;
      try {
        const session = await client.join(joinCode, signal);
        if (token !== generation || signal?.aborted) throw new AudienceConnectionError("aborted");
        if (Date.parse(issued.expiresAt) <= now())
          throw new AudienceConnectionError("unauthorized");
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
