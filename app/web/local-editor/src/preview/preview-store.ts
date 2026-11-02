import { createStore } from "zustand/vanilla";
import type { BuildJob, PreviewPlaybackResponse } from "@unframe/contracts/author-http";
export type LoadedPreview = {
  channel: "dev" | "dist";
  requestId: string;
  buildIdentity: string;
  sourceRevision: string | null;
};
export type PreviewPhase =
  | "idle"
  | "building"
  | "preparing"
  | "committing"
  | "confirming"
  | "ready"
  | "failed";
export type PreviewSnapshot = {
  phase: PreviewPhase;
  recovery: "healthy" | "restoring" | "reloadRequired";
  channel: "dev" | "dist";
  status: "idle" | "loading" | "ready" | "recovering" | "reload-required" | "error";
  loaded: LoadedPreview | null;
  job: BuildJob | null;
  playback: PreviewPlaybackResponse | null;
  error: string | null;
};
export const createPreviewStore = () =>
  createStore<PreviewSnapshot>(() => ({
    channel: "dev",
    status: "idle",
    phase: "idle",
    recovery: "healthy",
    loaded: null,
    job: null,
    playback: null,
    error: null,
  }));
export type PreviewStore = ReturnType<typeof createPreviewStore>;
