import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AudienceApplication } from "../../app/web/audience/src/connection/AudienceApplication";
import type { ViewingSnapshot } from "../../app/web/audience/src/experience/viewing-session";
import { createBrowserPlatform } from "./browser-platform";

export interface BrowserStatus {
  phase: ViewingSnapshot["phase"] | "ready";
  stepId: string;
  paused: boolean;
  reliableSequence: string;
  stateSequence: string;
  connections: number;
  assets: number;
  continued: boolean | null;
  surfaceState: string;
  opacity: number;
  drawCalls: number;
  texturedRenderers: number;
  renderedOpacity: number;
  renderedPixels: number;
  commandId?: string;
  commandResult?: "accepted" | "failed";
  error?: string;
}

declare global {
  interface Window {
    reportRealtimeE2E(status: BrowserStatus): void;
  }
}

const platform = createBrowserPlatform();
const root = document.getElementById("root");
if (!root) throw new Error("Audience E2E application root is missing.");
createRoot(root).render(
  createElement<NonNullable<Parameters<typeof AudienceApplication>[0]>>(AudienceApplication, {
    trackingAdapter: platform.createTrackingAdapter,
    onViewingSnapshot(snapshot: ViewingSnapshot) {
      const runtime = snapshot.runtime;
      const view = runtime?.view;
      window.reportRealtimeE2E({
        phase: snapshot.phase === "viewing" ? "ready" : snapshot.phase,
        stepId: view?.progression.currentStepId ?? "",
        paused: view?.clock.lifecycle.kind === "paused",
        reliableSequence: runtime?.reliableSequence ?? "0",
        stateSequence: runtime?.stateSequence ?? "0",
        connections: 0,
        assets: platform.getRendering().textures,
        continued:
          typeof view?.variables["continued"] === "boolean" ? view.variables["continued"] : null,
        surfaceState:
          view?.surfaceStates["reference-surface:reference-surface-root"]?.stateId ?? "",
        opacity: view?.nodeStates["reference-surface:surface-node"]?.opacity ?? -1,
        ...platform.getRendering(),
        ...(snapshot.error ? { error: snapshot.error } : {}),
      });
    },
  }),
);
