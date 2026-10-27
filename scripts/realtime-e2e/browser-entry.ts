import { audienceWebCapabilityProfileId } from "../../packages/contracts/src/presentation/index";
import { createAnonymousAudienceClient } from "../../app/web/audience/src/connection/anonymous-client";
import { createAudienceRealtime } from "../../app/web/audience/src/connection/realtime-client";
import { AudienceConnectionError } from "../../app/web/audience/src/connection/http-client";
import type { PreparedConnection } from "../../app/web/audience/src/connection/join-controller";
import type { RuntimeInput } from "../../app/web/audience/src/experience/viewing-session";
import { createRuntimeStore } from "../../app/web/audience/src/runtime/runtime-store";
import { buildPngPlan } from "../../app/web/audience/src/rendering/png-plan";
import { loadPngTexture } from "../../app/web/audience/src/assets/png-texture";

export interface BrowserStatus {
  phase: "connecting" | "ready" | "disconnected" | "ended" | "rejected" | "error";
  stepId: string;
  paused: boolean;
  reliableSequence: string;
  stateSequence: string;
  connections: number;
  assets: number;
  continued: boolean | null;
  surfaceState: string;
  opacity: number;
  error?: string;
  httpStatus?: number;
}

export async function startBrowserViewer(
  config: { controlPlaneOrigin: string; joinCode: string; sessionId: string },
  report: (status: BrowserStatus) => void,
) {
  const client = createAnonymousAudienceClient({
    apiOrigin: config.controlPlaneOrigin,
    capabilityProfileId: audienceWebCapabilityProfileId,
  });
  const realtime = createAudienceRealtime();
  const identity = await client.join(config.joinCode);
  if (identity.id !== config.sessionId) throw new Error("browser-session-mismatch");
  let generation = 0;
  let connections = 0;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let textures: Awaited<ReturnType<typeof loadPngTexture>>[] = [];
  let status: BrowserStatus = {
    phase: "connecting",
    stepId: "",
    paused: true,
    reliableSequence: "0",
    stateSequence: "0",
    connections,
    assets: 0,
    continued: null,
    surfaceState: "",
    opacity: -1,
  };
  const publish = (next: Partial<BrowserStatus>) => {
    status = { ...status, ...next, connections };
    report(status);
  };
  const releaseTextures = () => {
    for (const texture of textures) texture.dispose();
    textures = [];
  };
  const fail = (reason: string) => {
    stopped = true;
    generation++;
    clearTimeout(reconnect);
    realtime.dispose();
    releaseTextures();
    publish({ phase: "error", error: reason });
  };
  const disconnected = () => {
    if (stopped) return;
    generation++;
    realtime.dispose();
    releaseTextures();
    publish({ phase: status.phase === "ended" ? "ended" : "disconnected" });
    clearTimeout(reconnect);
    if (status.phase !== "ended") reconnect = setTimeout(() => void connect(), 2000);
  };
  async function connect() {
    if (stopped) return;
    const token = ++generation;
    try {
      const delivery = await client.delivery(identity.id);
      const bootstrap = await client.bootstrap(identity.id);
      if (token !== generation || stopped) return;
      const connection: PreparedConnection = { session: identity, delivery, bootstrap };
      const store = createRuntimeStore(delivery);
      let prepared = false;
      let preparing = false;
      let stateAttached = false;
      let readinessObserved = false;
      connections++;
      publish({ phase: "connecting" });
      const current = () => token === generation && !stopped;
      const inspect = () => {
        if (!current()) return;
        const snapshot = store.getSnapshot();
        if (snapshot.phase === "resync-required") {
          fail("browser-runtime-requires-resync");
          return;
        }
        const view = snapshot.view;
        if (snapshot.phase === "ended" || view?.clock.lifecycle.kind === "terminating") {
          publish({ phase: "ended" });
          return;
        }
        if (!view) return;
        publish({
          phase:
            prepared &&
            (snapshot.stateSync === "ready" ||
              (stateAttached && readinessObserved && view.clock.lifecycle.kind === "paused"))
              ? "ready"
              : "connecting",
          stepId: view.progression.currentStepId,
          paused: view.clock.lifecycle.kind === "paused",
          reliableSequence: snapshot.reliableSequence,
          stateSequence: snapshot.stateSequence,
          continued:
            typeof view.variables["continued"] === "boolean" ? view.variables["continued"] : null,
          surfaceState:
            view.surfaceStates["reference-surface:reference-surface-root"]?.stateId ?? "",
          opacity: view.nodeStates["reference-surface:surface-node"]?.opacity ?? -1,
        });
        if (!prepared && !preparing) {
          preparing = true;
          void (async () => {
            const plan = buildPngPlan(delivery, view);
            if (plan.assets.length === 0) throw new Error("browser-png-assets-missing");
            for (const asset of plan.assets) {
              const texture = await loadPngTexture(asset);
              if (!current()) {
                texture.dispose();
                return;
              }
              textures.push(texture);
            }
            if (!current()) return;
            prepared = true;
            publish({ assets: plan.assets.length });
            inspect();
          })().catch(() => {
            if (current()) fail("browser-asset-validation-failed");
          });
        }
      };
      const input: RuntimeInput = {
        applyControl(item) {
          if (!current()) return;
          store.applyControl(item);
          inspect();
        },
        applyState(item) {
          if (!current()) return;
          if (item.connected) stateAttached = true;
          store.applyState(item);
          inspect();
        },
        restartState() {
          if (!current()) return;
          store.restartState();
          inspect();
        },
        getReadiness() {
          if (!current() || !prepared) return null;
          const snapshot = store.getSnapshot();
          if (!readinessObserved) {
            readinessObserved = true;
            queueMicrotask(inspect);
          }
          return snapshot.phase === "ready" && snapshot.view
            ? {
                reliableSequence: snapshot.reliableSequence,
                presentationOriginVersion: String(snapshot.view.presentationOrigin.version),
              }
            : null;
        },
        disconnected,
      };
      realtime.install(
        input,
        connection,
        () => connection,
        () => {
          disconnected();
          return null;
        },
      );
    } catch (error) {
      if (!currentGeneration(token)) return;
      if (
        error instanceof AudienceConnectionError &&
        error.status !== undefined &&
        [401, 403, 404, 409, 410].includes(error.status)
      ) {
        publish({ phase: "rejected", httpStatus: error.status });
      } else {
        fail("browser-connection-preparation-failed");
      }
    }
  }
  function currentGeneration(token: number) {
    return token === generation && !stopped;
  }
  await connect();
  return () => {
    stopped = true;
    generation++;
    clearTimeout(reconnect);
    realtime.dispose();
    releaseTextures();
    void client.leave().catch(() => {});
  };
}
