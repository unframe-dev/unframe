import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import { assertViewerDelivery } from "../runtime/viewer-policy";
import {
  AudienceConnectionError,
  type Bootstrap,
  type Session,
  type createAudienceHttpClient,
} from "./http-client";

type PublicSession = Pick<Session, "id" | "state">;
export type JoinSnapshot =
  | { phase: "idle" | "joining" }
  | { phase: "delivery" | "bootstrap"; session: PublicSession }
  | { phase: "prepared"; session: PublicSession; expiresAt: string }
  | { phase: "error"; error: string; session?: PublicSession };
export interface PreparedConnection {
  session: Session;
  delivery: DeliveryManifestWire;
  bootstrap: Bootstrap;
}
export type JoinController = ReturnType<typeof createJoinController>;

function samePublication(
  wire: DeliveryManifestWire["publication"],
  fence: Bootstrap["publicationFence"],
): boolean {
  return (
    !!wire &&
    wire.presentationId === fence.presentationId &&
    wire.publicationEpoch === String(fence.publicationEpoch) &&
    wire.publicationManifestHash === fence.publicationManifestHash
  );
}
function validateDelivery(
  session: Session,
  delivery: DeliveryManifestWire,
  capabilityProfileId: string,
): void {
  try {
    assertViewerDelivery(delivery);
  } catch {
    throw new AudienceConnectionError("delivery-mismatch");
  }
  const profile = delivery.projectionProfile;
  if (
    delivery.sessionId !== session.id ||
    delivery.publication?.presentationId !== session.presentationId ||
    delivery.capabilityProfile?.capabilityProfileId !== capabilityProfileId ||
    profile?.key?.capabilityProfileId !== capabilityProfileId ||
    !profile.projectionProfileId ||
    profile.projectionProfileId !== delivery.projectionInstance?.projectionProfileId ||
    !samePublication(delivery.publication, {
      presentationId: profile.key.publication?.presentationId ?? "",
      publicationEpoch: Number(profile.key.publication?.publicationEpoch),
      publicationManifestHash: profile.key.publication?.publicationManifestHash ?? "",
    }) ||
    (session.publicationFence && !samePublication(delivery.publication, session.publicationFence))
  )
    throw new AudienceConnectionError("delivery-mismatch");
}
function validateBootstrap(delivery: DeliveryManifestWire, bootstrap: Bootstrap): void {
  if (
    bootstrap.projectionProfileId !== delivery.projectionProfile?.projectionProfileId ||
    String(bootstrap.assignmentEpoch) !== delivery.projectionInstance?.assignmentEpoch ||
    bootstrap.presentationId !== delivery.publication?.presentationId ||
    !samePublication(delivery.publication, bootstrap.publicationFence)
  )
    throw new AudienceConnectionError("delivery-mismatch");
}
function expiry(connection: PreparedConnection, now: number): number {
  const values = [
    Date.parse(connection.bootstrap.expiresAt),
    ...(connection.delivery.assetAccess ?? []).map((asset) => {
      const value = asset.expiresAtUnixMs;
      return value && /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN;
    }),
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value <= now))
    throw new AudienceConnectionError("expired-connection");
  return Math.min(...values);
}
function displayError(error: unknown): string {
  if (!(error instanceof AudienceConnectionError)) return "invalid-response";
  if (error.code !== "http-error") return error.code;
  return (
    (
      {
        401: "unauthorized",
        403: "forbidden",
        404: "not-found",
        409: "conflict",
        429: "rate-limited",
      } as Record<number, string>
    )[error.status ?? 0] ?? "server-error"
  );
}

export function createJoinController(options: {
  client: ReturnType<typeof createAudienceHttpClient>;
  capabilityProfileId: string;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: JoinSnapshot = { phase: "idle" };
  let prepared: PreparedConnection | null = null;
  let joinedSession: Session | null = null;
  let request: AbortController | null = null;
  let generation = 0;
  let disposed = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function publish(next: JoinSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function stop() {
    generation++;
    request?.abort();
    request = null;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    prepared = null;
  }
  function expire() {
    if (!prepared) return;
    try {
      expiry(prepared, now());
    } catch {
      stop();
      publish({
        phase: "error",
        error: "expired-connection",
        ...(joinedSession ? { session: { id: joinedSession.id, state: joinedSession.state } } : {}),
      });
    }
  }
  function scheduleExpiry() {
    if (!prepared) return;
    const remaining = expiry(prepared, now()) - now();
    expiryTimer = setTimeout(
      () => {
        expire();
        if (prepared) scheduleExpiry();
      },
      Math.min(remaining, 2_147_483_647),
    );
  }
  async function acquire(code?: string): Promise<void> {
    if (disposed) return;
    stop();
    const token = generation;
    const pending = new AbortController();
    request = pending;
    const current = () => !disposed && token === generation && !pending.signal.aborted;
    try {
      if (code !== undefined) {
        joinedSession = null;
        publish({ phase: "joining" });
        const joined = await options.client.join(code, pending.signal);
        if (!current()) return;
        joinedSession = structuredClone(joined);
      }
      const session = joinedSession;
      if (!session) {
        publish({ phase: "idle" });
        return;
      }
      if (session.state === "Ended") throw new AudienceConnectionError("session-ended");
      const publicSession = { id: session.id, state: session.state };
      publish({ phase: "delivery", session: publicSession });
      const delivery = await options.client.delivery(session.id, pending.signal);
      if (!current()) return;
      validateDelivery(session, delivery, options.capabilityProfileId);
      publish({ phase: "bootstrap", session: publicSession });
      const bootstrap = await options.client.bootstrap(session.id, pending.signal);
      if (!current()) return;
      validateBootstrap(delivery, bootstrap);
      joinedSession = { ...session, publicationFence: { ...bootstrap.publicationFence } };
      const connection = structuredClone({ session: joinedSession, delivery, bootstrap });
      const until = expiry(connection, now());
      prepared = connection;
      scheduleExpiry();
      publish({
        phase: "prepared",
        session: publicSession,
        expiresAt: new Date(until).toISOString(),
      });
    } catch (error) {
      if (!current()) return;
      prepared = null;
      publish({
        phase: "error",
        error: displayError(error),
        ...(joinedSession ? { session: { id: joinedSession.id, state: joinedSession.state } } : {}),
      });
    } finally {
      if (current()) request = null;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getPrepared(): PreparedConnection | null {
      expire();
      return prepared ? structuredClone(prepared) : null;
    },
    join(code: string) {
      return acquire(code.trim().toUpperCase());
    },
    refresh() {
      return acquire();
    },
    cancel() {
      stop();
      joinedSession = null;
      if (!disposed) publish({ phase: "idle" });
    },
    leave() {
      stop();
      joinedSession = null;
      if (!disposed) publish({ phase: "idle" });
    },
    dispose() {
      stop();
      joinedSession = null;
      disposed = true;
      snapshot = { phase: "idle" };
      listeners.clear();
    },
  };
}
