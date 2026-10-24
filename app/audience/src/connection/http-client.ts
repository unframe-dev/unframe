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

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const publicationFence = z.object({
  presentationId: identifier,
  publicationEpoch: positiveInteger,
  publicationManifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
const sessionSchema: z.ZodType<Session> = z.object({
  id: identifier,
  presentationId: identifier,
  presenterId: identifier,
  state: z.enum(["Waiting", "Presenting", "Ended"]),
  participantCount: z.number().int().min(1).max(50),
  maxParticipants: z.literal(50),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  publicationFence: publicationFence.nullable(),
});
function safeHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
const bootstrapSchema: z.ZodType<Bootstrap> = z.object({
  endpoint: z.string().refine(safeHttps),
  fingerprint: z.string().nullable(),
  runtimeId: identifier,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
  assignmentEpoch: positiveInteger,
  presentationId: identifier,
  presentationRevision: positiveInteger,
  credential: z.string().min(1),
  expiresAt: z.iso.datetime(),
  publicationFence,
  projectionProfileId: identifier,
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
  options: { fetch?: typeof fetch; now?: () => number } = {},
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
  async function request(
    path: string,
    contentType: string,
    body: object | undefined,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new AudienceConnectionError("aborted");
    let response: Response;
    try {
      response = await requestFetch(`${origin}${path}`, {
        method: "POST",
        credentials: "include",
        mode: "cors",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: contentType, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new AudienceConnectionError(signal?.aborted ? "aborted" : "network-error");
    }
    if (signal?.aborted) throw new AudienceConnectionError("aborted");
    if (response.status !== 200) throw new AudienceConnectionError("http-error", response.status);
    if (
      response.redirected ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== contentType
    )
      invalidResponse();
    return response;
  }
  async function json(response: Response, signal?: AbortSignal): Promise<unknown> {
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
      if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(joinCode))
        throw new AudienceConnectionError("invalid-join-code");
      const value = validate(
        sessionSchema,
        await json(
          await request("/sessions/join", "application/json", { joinCode }, signal),
          signal,
        ),
      );
      if (value.publicationFence && value.publicationFence.presentationId !== value.presentationId)
        invalidResponse();
      return value;
    },
    async delivery(id: string, signal?: AbortSignal): Promise<DeliveryManifestWire> {
      const response = await request(
        `/sessions/${sessionId(id)}/delivery`,
        "application/x-protobuf",
        { capabilityProfileId: config.capabilityProfileId },
        signal,
      );
      try {
        const value = decodeWireMessage(
          "unframe.delivery.DeliveryManifest",
          new Uint8Array(await response.arrayBuffer()),
        ) as DeliveryManifestWire;
        if (signal?.aborted) throw new AudienceConnectionError("aborted");
        if (
          value.schemaVersion !== 2 ||
          value.deliveryContractVersion !== 2 ||
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
      const value = validate(
        bootstrapSchema,
        await json(
          await request(
            `/sessions/${sessionId(id)}/bootstrap`,
            "application/json",
            undefined,
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
