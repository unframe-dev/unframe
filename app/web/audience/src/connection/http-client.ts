import {
  controlPlaneIdentifierSchema as identifier,
  sessionJoinCodeSchema,
  sessionResourceSchema,
  realtimeConnectionSchema,
} from "@unframe/contracts/control-plane-http";
import { createControlPlaneClient } from "@unframe/api-client-typescript";
import type { paths } from "@unframe/contracts/control-plane";
import { decodeWireMessage, type DeliveryManifestWire } from "@unframe/contracts/presentation";
import { z } from "zod";

export type Session =
  paths["/sessions/join"]["post"]["responses"][200]["content"]["application/json"];
export type Bootstrap =
  paths["/sessions/{id}/bootstrap"]["post"]["responses"][200]["content"]["application/json"];

export class AudienceConnectionError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "AudienceConnectionError";
  }
}

type AudienceResponse = Pick<
  Response,
  "status" | "headers" | "redirected" | "json" | "arrayBuffer"
>;

export async function audienceResponseError(
  response: AudienceResponse,
): Promise<AudienceConnectionError> {
  if (
    [409, 410].includes(response.status) &&
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  ) {
    const body: unknown = await response.json().catch(() => null);
    if (
      response.status === 409 &&
      z.object({ error: z.object({ code: z.literal("runtime_unavailable") }) }).safeParse(body)
        .success
    )
      return new AudienceConnectionError("runtime-unavailable", 409);
    if (
      response.status === 410 &&
      z.object({ error: z.object({ code: z.literal("session_ended") }) }).safeParse(body).success
    )
      return new AudienceConnectionError("session-ended", 410);
  }
  return new AudienceConnectionError("http-error", response.status);
}

const sessionSchema: z.ZodType<Session> = sessionResourceSchema.extend({
  id: identifier,
  presentationId: identifier,
  presenterId: identifier,
  publicationFence: realtimeConnectionSchema.shape.publicationFence.nullable(),
});
function safeHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
const bootstrapSchema: z.ZodType<Bootstrap> = realtimeConnectionSchema.extend({
  endpoint: realtimeConnectionSchema.shape.endpoint.refine(safeHttps),
  credential: z.string().min(1),
});
function invalidResponse(): never {
  throw new AudienceConnectionError("invalid-response");
}
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : invalidResponse();
}

export function createAudienceHttpClient(
  config: { apiOrigin: string; capabilityProfileId: string },
  options: { fetch?: typeof fetch; now?: () => number; authorization?: () => string | null } = {},
) {
  let origin: string;
  try {
    const parsed = new URL(config.apiOrigin);
    if (
      !safeHttps(config.apiOrigin) ||
      parsed.pathname !== "/" ||
      parsed.search ||
      !identifier.safeParse(config.capabilityProfileId).success
    )
      throw new Error();
    origin = parsed.origin;
  } catch {
    throw new AudienceConnectionError("invalid-config");
  }
  const requestFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const rpc = createControlPlaneClient({
    baseUrl: origin,
    fetch: requestFetch,
    credentials: options.authorization ? "omit" : "include",
  });
  async function request(
    send: (options: {
      init: RequestInit;
      headers: Record<string, string>;
    }) => Promise<AudienceResponse>,
    contentType: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new AudienceConnectionError("aborted");
    const authorization = options.authorization?.();
    let response: AudienceResponse;
    try {
      response = await send({
        init: {
          mode: "cors",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          ...(signal ? { signal } : {}),
        },
        headers: {
          Accept: contentType,
          ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
        },
      });
    } catch {
      throw new AudienceConnectionError(signal?.aborted ? "aborted" : "network-error");
    }
    if (signal?.aborted) throw new AudienceConnectionError("aborted");
    if (response.status !== 200) throw await audienceResponseError(response);
    if (
      response.redirected ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== contentType
    )
      invalidResponse();
    return response;
  }
  async function json(response: AudienceResponse, signal?: AbortSignal): Promise<unknown> {
    try {
      const value: unknown = await response.json();
      if (signal?.aborted) throw new AudienceConnectionError("aborted");
      return value;
    } catch (error) {
      if (signal?.aborted) throw new AudienceConnectionError("aborted");
      if (error instanceof AudienceConnectionError) throw error;
      return invalidResponse();
    }
  }
  function sessionId(value: string): string {
    if (!identifier.safeParse(value).success)
      throw new AudienceConnectionError("invalid-session-id");
    return value;
  }
  return {
    async join(joinCode: string, signal?: AbortSignal): Promise<Session> {
      if (!sessionJoinCodeSchema.safeParse(joinCode).success)
        throw new AudienceConnectionError("invalid-join-code");
      const value = validate(
        sessionSchema,
        await json(
          await request(
            (request) => rpc.sessions.join.$post({ json: { joinCode } }, request),
            "application/json",
            signal,
          ),
          signal,
        ),
      );
      if (value.publicationFence && value.publicationFence.presentationId !== value.presentationId)
        invalidResponse();
      return value;
    },
    async delivery(id: string, signal?: AbortSignal): Promise<DeliveryManifestWire> {
      const safeId = sessionId(id);
      const response = await request(
        (request) =>
          rpc.sessions[":sessionId"].delivery.$post(
            {
              param: { sessionId: safeId },
              json: { capabilityProfileId: config.capabilityProfileId },
            },
            request,
          ),
        "application/x-protobuf",
        signal,
      );
      try {
        const value = decodeWireMessage(
          "unframe.delivery.DeliveryManifest",
          new Uint8Array(await response.arrayBuffer()),
        ) as DeliveryManifestWire;
        if (signal?.aborted) throw new AudienceConnectionError("aborted");
        if (
          value.schemaVersion !== 3 ||
          value.deliveryContractVersion !== 3 ||
          value.sessionId !== id ||
          !value.publication ||
          !value.projectionProfile ||
          !value.projectionInstance
        )
          invalidResponse();
        return value;
      } catch (error) {
        if (signal?.aborted) throw new AudienceConnectionError("aborted");
        if (error instanceof AudienceConnectionError) throw error;
        return invalidResponse();
      }
    },
    async bootstrap(id: string, signal?: AbortSignal): Promise<Bootstrap> {
      const safeId = sessionId(id);
      const value = validate(
        bootstrapSchema,
        await json(
          await request(
            (request) => rpc.sessions[":id"].bootstrap.$post({ param: { id: safeId } }, request),
            "application/json",
            signal,
          ),
          signal,
        ),
      );
      if (value.publicationFence.presentationId !== value.presentationId) invalidResponse();
      if (Date.parse(value.expiresAt) <= now())
        throw new AudienceConnectionError("expired-bootstrap");
      return value;
    },
  };
}
