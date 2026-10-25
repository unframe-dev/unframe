import type { AnchorSessionSnapshot } from "../experience/anchor-session";
import type { ViewingSnapshot } from "../experience/viewing-session";
import { safeDiagnosticError, summarizeTrackingDiagnostics } from "./tracking-summary";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function status(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}
function sequence(value: unknown): string | null {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value) ? value : null;
}

export function buildViewerDiagnostic(options: {
  tracking: AnchorSessionSnapshot | null;
  viewing: ViewingSnapshot | null;
  context: Parameters<typeof summarizeTrackingDiagnostics>[0];
}) {
  const { tracking, viewing } = options;
  const runtime = viewing?.runtime;
  return {
    schemaVersion: 1,
    mode: "audience-viewer",
    recordedAt: new Date().toISOString(),
    tracking: tracking
      ? {
          stage: status(tracking.stage, ["ready", "starting", "running", "stopped", "error"]),
          error: safeDiagnosticError(tracking.error),
          status: status(tracking.tracking, ["NORMAL", "LIMITED"]),
          detection: status(tracking.detection, ["waiting", "preparing", "active"]),
          anchorUpdateCount: finite(tracking.anchorUpdateCount),
          completionHz: finite(tracking.completionHz),
          lastTagAtMs: finite(tracking.lastTagAtMs),
          nowMs: finite(tracking.nowMs),
          mediaPlaybackBlocked: tracking.mediaPlaybackBlocked === true,
        }
      : null,
    viewing: viewing
      ? {
          phase: status(viewing.phase, [
            "idle",
            "starting",
            "awaiting-snapshot",
            "loading",
            "viewing",
            "resync-required",
            "disconnected",
            "ended",
            "error",
          ]),
          error: safeDiagnosticError(viewing.error),
          recovery: viewing.recovery
            ? {
                kind: status(viewing.recovery.kind, ["snapshot", "keyframe"]),
                afterSequence: sequence(viewing.recovery.afterSequence),
              }
            : null,
          runtime: runtime
            ? {
                phase: status(runtime.phase, [
                  "awaiting-snapshot",
                  "ready",
                  "resync-required",
                  "ended",
                ]),
                rendering: status(runtime.rendering, ["idle", "loading", "ready", "error"]),
                stateSync: status(runtime.stateSync, ["awaiting-keyframe", "ready"]),
                error: safeDiagnosticError(runtime.error),
                reason: safeDiagnosticError(runtime.reason),
                reliableSequence: sequence(runtime.reliableSequence),
                stateSequence: sequence(runtime.stateSequence),
                activeRuns: Array.isArray(runtime.view?.activeRuns)
                  ? runtime.view.activeRuns.length
                  : 0,
                clock: runtime.view?.clock
                  ? {
                      runtimeTimeMilliseconds: finite(runtime.view.clock.runtimeTimeMilliseconds),
                      lifecycle: status(runtime.view.clock.lifecycle?.kind, [
                        "running",
                        "paused",
                        "terminating",
                      ]),
                    }
                  : null,
              }
            : null,
        }
      : null,
    diagnostics: summarizeTrackingDiagnostics(options.context),
  };
}
