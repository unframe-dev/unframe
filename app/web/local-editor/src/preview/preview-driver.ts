import type { z } from "zod";
import type {
  LocalPreviewEnvelopeWire,
  PreviewPlaybackResponse,
  PreviewSpatialState,
  previewPresenterPositionSchema,
} from "@unframe-dev/contracts/author-http";
import type { UnityNotification } from "../infra/unity-exchange";
export type PreviewView = "perspective" | "overhead";
export type PresenterMovement = z.infer<typeof previewPresenterPositionSchema>;
export type SurfaceInteraction = { requestId: string; surfaceId: string; interactionId: string };
export type PreviewDriver = {
  prepare(envelope: LocalPreviewEnvelopeWire, signal?: AbortSignal): Promise<string>;
  commit(requestId: string, signal?: AbortSignal): Promise<string>;
  playback(
    state: PreviewPlaybackResponse["state"],
    signal?: AbortSignal,
    spatial?: PreviewSpatialState,
  ): Promise<void>;
  restore(
    state: PreviewPlaybackResponse["state"],
    signal?: AbortSignal,
    spatial?: PreviewSpatialState,
  ): Promise<void>;
  view(mode: PreviewView): Promise<void>;
  resetCamera(): Promise<void>;
  subscribeInteraction(listener: (interaction: SurfaceInteraction) => void): () => void;
  subscribePresenter(listener: (movement: PresenterMovement) => void): () => void;
  discard(requestId: string): Promise<void>;
  invalidate(): Promise<void>;
  subscribeFailure(listener: (notification: UnityNotification) => void): () => void;
  dispose(): Promise<void>;
};
