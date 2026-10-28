export type VideoMetadata = {
  mediaType: "video/mp4";
  codec: "h264";
  checksum: string;
  encodedSizeBytes: number;
  durationMilliseconds: number;
  pixelSize: [number, number];
  alpha: false;
  audio: boolean;
  requiredFeatures: ("h264" | "audio")[];
};

export const VIDEO_VALIDATION_IDENTITY = Object.freeze({
  validatorId: "unframe-mp4",
  version: "2",
  profile: "avc-high-l41-yuv420p-progressive-aac-lc-48k",
  duration: "edit-list-packet-end-v2",
});
