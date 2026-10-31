import type {
  LocalPreviewEnvelopeWire,
  PreviewPlaybackResponse,
} from "@unframe/core/cli/author-contract";
import type { UnityNotification } from "../infra/unity-exchange";
export type PreviewDriver = {
  prepare(envelope: LocalPreviewEnvelopeWire, signal?: AbortSignal): Promise<string>;
  commit(requestId: string, signal?: AbortSignal): Promise<string>;
  playback(state: PreviewPlaybackResponse["state"], signal?: AbortSignal): Promise<void>;
  restore(state: PreviewPlaybackResponse["state"], signal?: AbortSignal): Promise<void>;
  discard(requestId: string): Promise<void>;
  invalidate(): Promise<void>;
  subscribeFailure(listener: (notification: UnityNotification) => void): () => void;
  dispose(): Promise<void>;
};
