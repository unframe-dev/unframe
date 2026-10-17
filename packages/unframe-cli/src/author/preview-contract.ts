import { z } from "zod";
import type {
  LocalPreviewEnvelopeWire,
  LocalPreviewPlaybackStateWire,
} from "@unframe/contracts/presentation";
import type { BuildArtifacts } from "@unframe/unframe-core";
import { randomIdSchema } from "./contract.js";

export const previewLoadRequestSchema = z.discriminatedUnion("channel", [
  z.object({ requestId: randomIdSchema, channel: z.literal("dist") }).strict(),
  z
    .object({
      requestId: randomIdSchema,
      channel: z.literal("dev"),
      generationId: randomIdSchema,
      sourceRevision: z.string().min(1).max(256),
    })
    .strict(),
]);
export const previewCommittedRequestSchema = z
  .object({
    requestId: randomIdSchema,
    buildIdentity: z.string().min(1),
  })
  .strict();
export const previewPlaybackCommandSchema = z.discriminatedUnion("command", [
  z
    .object({ requestId: randomIdSchema, command: z.enum(["poll", "play", "pause", "reset"]) })
    .strict(),
  z
    .object({
      requestId: randomIdSchema,
      command: z.literal("input"),
      cueId: z.string().min(1).max(1024),
    })
    .strict(),
]);
export type PreviewPlaybackCommand = z.infer<typeof previewPlaybackCommandSchema>;
export type PreviewPlaybackResponse = {
  state: LocalPreviewPlaybackStateWire;
  inputs: Array<{ cueId: string; label: string }>;
  groupId: string;
  stepId: string;
  ended: boolean;
};
export type PreviewLoadRequest = z.infer<typeof previewLoadRequestSchema>;
export type PreviewCommittedRequest = z.infer<typeof previewCommittedRequestSchema>;
export type PreviewAsset = { bytes: Uint8Array; mediaType: string };
export type PinnedPreviewDist = {
  generationId: string;
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<PreviewAsset>;
};
export type LocalPreviewService = {
  load(input: PreviewLoadRequest, signal?: AbortSignal): Promise<LocalPreviewEnvelopeWire>;
  committed(input: PreviewCommittedRequest): void;
  playback(input: PreviewPlaybackCommand): PreviewPlaybackResponse;
  invalidate(): void;
  asset(requestId: string, reference: string): Promise<PreviewAsset>;
  pinDisplayedDist(requestId: string): Promise<PinnedPreviewDist>;
  close(): void;
};
