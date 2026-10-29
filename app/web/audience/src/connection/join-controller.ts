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
  | { phase: "delivery" | "bootstrap" | "recovering"; session: PublicSession }
  | {
      phase: "prepared";
      session: PublicSession;
      expiresAt: string;
      revision: number;
      refreshing: boolean;
      refreshError: string | null;
    }
  | { phase: "error"; error: string; session?: PublicSession }
  | { phase: "ended"; session: PublicSession };
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
        410: "connection-unavailable",
        429: "rate-limited",
      } as Record<number, string>
    )[error.status ?? 0] ?? "server-error"
  );
}

export function createJoinController(options: {
  client: ReturnType<typeof createAudienceHttpClient> & { leave?(): Promise<void> };
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
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingWork: Promise<void> | null = null;
  let revision = 0;
  let retryCount = 0;
  let recoveryAttempt = 0;
  let recovering = false;
  function publish(next: JoinSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function releaseIdentity() {
    void options.client.leave?.().catch(() => {});
  }
  function stop() {
    generation++;
    request?.abort();
    request = null;
    pendingWork = null;
    clearTimeout(expiryTimer);
    clearTimeout(refreshTimer);
    expiryTimer = undefined;
    refreshTimer = undefined;
    prepared = null;
    retryCount = 0;
    recoveryAttempt = 0;
    recovering = false;
  }
  function publishPrepared(refreshing: boolean, refreshError: string | null = null) {
    if (!prepared) return;
    publish({
      phase: "prepared",
      session: { id: prepared.session.id, state: prepared.session.state },
      expiresAt: new Date(expiry(prepared, now())).toISOString(),
      revision,
      refreshing,
      refreshError,
    });
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
    clearTimeout(expiryTimer);
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
  function scheduleRefresh(retry = false) {
    clearTimeout(refreshTimer);
    if (!prepared || disposed) return;
    const remaining = expiry(prepared, now()) - now();
    const delay = retry
      ? 1000 * 2 ** retryCount++
      : Math.max(1000, remaining - Math.min(30_000, remaining / 2));
    // A lease may cap refreshed credentials at the same deadline. Avoid a tight
    // refresh loop near expiry and keep the original expiry timer authoritative.
    if ((retry && retryCount > 3) || delay >= remaining) return;
    refreshTimer = setTimeout(
      () => {
        refreshTimer = undefined;
        void acquire();
      },
      Math.min(delay, 2_147_483_647),
    );
  }
  function waitForRuntime() {
    if (!joinedSession || disposed) return;
    prepared = null;
    recovering = true;
    clearTimeout(expiryTimer);
    clearTimeout(refreshTimer);
    expiryTimer = undefined;
    publish({ phase: "recovering", session: { id: joinedSession.id, state: joinedSession.state } });
    const delay = Math.min(5000, 250 * 2 ** recoveryAttempt);
    recoveryAttempt = Math.min(5, recoveryAttempt + 1);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void acquire(undefined, true);
    }, delay);
  }
  function acquire(code?: string, reconnecting = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (code === undefined) {
      expire();
      if (pendingWork) return pendingWork;
    } else stop();
    const token = generation;
    const pending = new AbortController();
    request = pending;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    const current = () => !disposed && token === generation && !pending.signal.aborted;
    const retaining = prepared !== null;
    if (retaining) publishPrepared(true);
    const work = (async () => {
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
        if (!retaining && !recovering) publish({ phase: "delivery", session: publicSession });
        const delivery = await options.client.delivery(session.id, pending.signal);
        if (!current()) return;
        validateDelivery(session, delivery, options.capabilityProfileId);
        if (!retaining && !recovering) publish({ phase: "bootstrap", session: publicSession });
        const bootstrap = await options.client.bootstrap(session.id, pending.signal);
        if (!current()) return;
        if (retaining) expire();
        if (!current()) return;
        validateBootstrap(delivery, bootstrap);
        const nextSession = { ...session, publicationFence: { ...bootstrap.publicationFence } };
        const connection = structuredClone({ session: nextSession, delivery, bootstrap });
        expiry(connection, now());
        joinedSession = nextSession;
        prepared = connection;
        revision++;
        recovering = false;
        recoveryAttempt = 0;
        retryCount = 0;
        scheduleExpiry();
        scheduleRefresh();
        publishPrepared(false);
      } catch (error) {
        if (!current()) return;
        if (
          error instanceof AudienceConnectionError &&
          (error.code === "runtime-unavailable" ||
            ((recovering || reconnecting) &&
              (error.code === "network-error" ||
                (error.code === "http-error" &&
                  (error.status === 429 || (error.status ?? 0) >= 500)))))
        ) {
          waitForRuntime();
          return;
        }
        if (
          error instanceof AudienceConnectionError &&
          (error.code === "session-ended" ||
            error.code === "unauthorized" ||
            (error.code === "http-error" && [401, 403, 404, 410].includes(error.status ?? 0)))
        ) {
          const session = joinedSession;
          stop();
          releaseIdentity();
          joinedSession = null;
          if (error.code === "session-ended" && session)
            publish({ phase: "ended", session: { id: session.id, state: "Ended" } });
          else
            publish({
              phase: "error",
              error: displayError(error),
              ...(session ? { session: { id: session.id, state: session.state } } : {}),
            });
          return;
        }
        expire();
        if (!current()) return;
        if (prepared) {
          publishPrepared(false, displayError(error));
          if (!reconnecting) scheduleRefresh(true);
        } else {
          publish({
            phase: "error",
            error: displayError(error),
            ...(joinedSession
              ? { session: { id: joinedSession.id, state: joinedSession.state } }
              : {}),
          });
        }
      } finally {
        if (current()) {
          request = null;
          pendingWork = null;
        }
      }
    })();
    pendingWork = work;
    void work.then(() => {
      if (pendingWork === work) pendingWork = null;
    });
    return work;
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
    reconnect() {
      return acquire(undefined, true);
    },
    cancel() {
      stop();
      releaseIdentity();
      joinedSession = null;
      if (!disposed) publish({ phase: "idle" });
    },
    leave() {
      stop();
      releaseIdentity();
      joinedSession = null;
      if (!disposed) publish({ phase: "idle" });
    },
    dispose() {
      stop();
      releaseIdentity();
      joinedSession = null;
      disposed = true;
      snapshot = { phase: "idle" };
      listeners.clear();
    },
  };
}
