import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ValidationResult } from "@unframe/core";
import type { VideoMetadata } from "./types.js";

const integer = z
  .union([
    z.number().int().safe(),
    z
      .string()
      .max(20)
      .regex(/^-?\d+$/u),
  ])
  .transform(BigInt);
const streamSchema = z.object({
  index: z.number().int().nonnegative(),
  codec_type: z.enum(["video", "audio"]),
  codec_name: z.string(),
  codec_tag_string: z.string().optional(),
  profile: z.string(),
  time_base: z
    .string()
    .max(43)
    .regex(/^\d+\/\d+$/u),
  start_pts: integer,
  duration_ts: integer,
  level: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  pix_fmt: z.string().optional(),
  field_order: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().optional(),
});
const probeSchema = z.object({
  streams: z.array(streamSchema).min(1).max(2),
  format: z.object({
    format_name: z.string(),
    duration: z
      .string()
      .max(40)
      .regex(/^\d+(?:\.\d+)?$/u),
  }),
  packets: z
    .array(
      z.object({
        stream_index: z.number().int(),
        pts: integer,
        dts: integer,
        duration: integer,
        side_data_list: z
          .array(
            z.object({
              skip_samples: z.number().int().nonnegative().optional(),
              discard_padding: z.number().int().nonnegative().optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(200_000),
});
const framesSchema = z.object({
  frames: z
    .array(
      z.object({
        media_type: z.enum(["video", "audio"]),
        stream_index: z.number().int(),
        pts: integer,
        width: z.number().optional(),
        height: z.number().optional(),
        pix_fmt: z.string().optional(),
        interlaced_frame: z.number().optional(),
        sample_rate: z.string().optional(),
        channels: z.number().optional(),
      }),
    )
    .min(1)
    .max(200_000),
});
const headerValues = z.array(z.number().int()).min(1).max(128);
const headersSchema = z.object({
  profiles: headerValues,
  levels: headerValues,
  chromaFormats: headerValues,
  lumaDepths: headerValues,
  chromaDepths: headerValues,
  frameOnly: headerValues,
});
const requestSchema = z.strictObject({
  sourceId: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
  probeJson: z.string().max(32 * 1024 * 1024),
  framesJson: z.string().max(32 * 1024 * 1024),
  headersJson: z.string().max(1024 * 1024),
  fullDecodeSucceeded: z.literal(true),
});

type Rational = { n: bigint; d: bigint };
const rational = (n: bigint, d: bigint): Rational => {
  if (d <= 0n) throw new Error("Invalid time base.");
  return { n, d };
};
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
const timeBase = (text: string) => {
  const [n, d] = text.split("/").map(BigInt);
  if (!n || !d) throw new Error("Invalid time base.");
  return rational(n, d);
};
const failure = (code: string, message: string): ValidationResult<VideoMetadata> => ({
  valid: false,
  diagnostics: [{ code, path: [], message }],
});

export const validateMp4Inspection = (input: unknown): ValidationResult<VideoMetadata> => {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      (Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null) ||
      Object.getOwnPropertySymbols(input).length
    )
      return failure("video-invalid-inspection", "Expected a data-only inspection.");
    const snapshot: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!descriptor.enumerable || !("value" in descriptor))
        return failure("video-invalid-inspection", "Inspection accessors are not allowed.");
      Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true });
    }
    const typed = Object.getPrototypeOf(Uint8Array.prototype);
    const length = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!.call(
      snapshot.bytes,
    ) as number;
    const buffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!.call(snapshot.bytes);
    Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!.call(buffer);
    if (
      Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!.call(snapshot.bytes) !==
        "Uint8Array" ||
      length < 20 ||
      length > 64 * 1024 * 1024
    )
      return failure("video-budget-exceeded", "MP4 input exceeds the encoded byte limit.");
    const bytes = new Uint8Array(length);
    Uint8Array.prototype.set.call(bytes, snapshot.bytes as Uint8Array);
    const request = requestSchema.parse({ ...snapshot, bytes });
    const probe = probeSchema.parse(JSON.parse(request.probeJson));
    const frames = framesSchema.parse(JSON.parse(request.framesJson)).frames;
    const headers = headersSchema.parse(JSON.parse(request.headersJson));
    if (
      new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp" ||
      !probe.format.format_name.split(",").includes("mp4")
    )
      return failure("video-container-unsupported", "Expected an MP4 container.");
    const videos = probe.streams.filter((stream) => stream.codec_type === "video");
    const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
    const video = videos[0];
    if (
      videos.length !== 1 ||
      !video ||
      audio.length > 1 ||
      new Set(probe.streams.map((stream) => stream.index)).size !== probe.streams.length
    )
      return failure(
        "video-tracks-unsupported",
        "MP4 requires one video and at most one audio track.",
      );
    if (
      video.codec_name !== "h264" ||
      video.codec_tag_string !== "avc1" ||
      video.profile !== "High" ||
      !video.level ||
      video.level > 41 ||
      video.level < 10 ||
      video.pix_fmt !== "yuv420p" ||
      video.field_order !== "progressive" ||
      !video.width ||
      !video.height ||
      video.width <= 0 ||
      video.height <= 0 ||
      Math.ceil(video.width / 16) * Math.ceil(video.height / 16) > 8192 ||
      video.width > 4096 ||
      video.height > 4096
    )
      return failure(
        "video-codec-unsupported",
        "Video requires avc1 with bounded progressive AVC High up to level 4.1, 8-bit 4:2:0.",
      );
    if (
      headers.profiles.some((value) => value !== 100) ||
      headers.levels.some((value) => value < 10 || value > 41) ||
      headers.chromaFormats.some((value) => value !== 1) ||
      headers.lumaDepths.some((value) => value !== 0) ||
      headers.chromaDepths.some((value) => value !== 0) ||
      headers.frameOnly.some((value) => value !== 1)
    )
      return failure(
        "video-codec-unsupported",
        "Every AVC sequence header must satisfy the profile.",
      );
    if (
      audio.some(
        (stream) =>
          stream.codec_name !== "aac" ||
          stream.profile !== "LC" ||
          stream.sample_rate !== "48000" ||
          ![1, 2].includes(stream.channels ?? 0),
      )
    )
      return failure("video-audio-unsupported", "Audio requires AAC-LC at 48 kHz, mono or stereo.");
    let finalEnd = rational(0n, 1n);
    for (const stream of probe.streams) {
      if (stream.start_pts < 0n || stream.duration_ts <= 0n)
        return failure(
          "video-timing-invalid",
          "Tracks require nonnegative start and positive duration.",
        );
      const base = timeBase(stream.time_base);
      const end = rational((stream.start_pts + stream.duration_ts) * base.n, base.d);
      const packets = probe.packets.filter((packet) => packet.stream_index === stream.index);
      const decoded = frames.filter((frame) => frame.stream_index === stream.index);
      if (!packets.length || !decoded.length)
        return failure("video-timing-invalid", "Each track must have packets and decoded frames.");
      let packetEnd: Rational | undefined;
      let previousDts: bigint | undefined;
      for (const packet of packets) {
        if (packet.duration <= 0n || (previousDts !== undefined && packet.dts <= previousDts))
          return failure(
            "video-timing-invalid",
            "Packets require positive duration and increasing decode timestamps.",
          );
        previousDts = packet.dts;
        const hasPadding = packet.side_data_list?.some((data) => (data.discard_padding ?? 0) > 0);
        if (hasPadding && stream.codec_type !== "audio")
          return failure("video-timing-invalid", "Unexpected video sample padding.");
        // MP4 packet duration already excludes AAC end padding; discard_padding trims decoder output.
        const current = rational((packet.pts + packet.duration) * base.n, base.d);
        if (!packetEnd || compare(current, packetEnd) > 0n) packetEnd = current;
      }
      if (!packetEnd || compare(packetEnd, end) !== 0n)
        return failure(
          "video-timing-invalid",
          "Packet presentation end and declared track duration disagree.",
        );
      let previousPts: bigint | undefined;
      for (const frame of decoded) {
        if (
          frame.media_type !== stream.codec_type ||
          frame.pts < stream.start_pts ||
          frame.pts >= stream.start_pts + stream.duration_ts ||
          (previousPts !== undefined && frame.pts <= previousPts)
        )
          return failure(
            "video-timing-invalid",
            "Decoded presentation timestamps must be ordered within the track.",
          );
        previousPts = frame.pts;
        if (
          stream.codec_type === "video" &&
          (frame.width !== video.width ||
            frame.height !== video.height ||
            frame.pix_fmt !== "yuv420p" ||
            frame.interlaced_frame !== 0)
        )
          return failure(
            "video-codec-unsupported",
            "Decoded video parameters must remain constant.",
          );
        if (
          stream.codec_type === "audio" &&
          (frame.channels !== stream.channels ||
            (frame.sample_rate !== undefined && frame.sample_rate !== "48000"))
        )
          return failure(
            "video-audio-unsupported",
            "Decoded audio parameters must remain constant.",
          );
      }
      if (compare(end, finalEnd) > 0n) finalEnd = end;
    }
    const streamIds = new Set(probe.streams.map((stream) => stream.index));
    if (
      probe.packets.some((packet) => !streamIds.has(packet.stream_index)) ||
      frames.some((frame) => !streamIds.has(frame.stream_index))
    )
      return failure("video-tracks-unsupported", "Inspection contains undeclared tracks.");
    const duration = Number((finalEnd.n * 1000n + finalEnd.d - 1n) / finalEnd.d);
    const [whole, fraction = ""] = probe.format.duration.split(".");
    const decimalBase = 10n ** BigInt(fraction.length);
    const container = BigInt(whole!) * decimalBase + BigInt(fraction || "0");
    if ((container * 1000n + decimalBase - 1n) / decimalBase !== BigInt(duration))
      return failure(
        "video-timing-invalid",
        "Container and track presentation duration disagree in canonical milliseconds.",
      );
    if (!Number.isSafeInteger(duration) || duration <= 0)
      return failure("video-timing-invalid", "Video duration must be a positive safe integer.");
    return {
      valid: true,
      value: {
        mediaType: "video/mp4",
        codec: "h264",
        checksum: `sha256:${bytesToHex(sha256(bytes))}`,
        encodedSizeBytes: bytes.length,
        durationMilliseconds: duration,
        pixelSize: [video.width, video.height],
        alpha: false,
        audio: audio.length === 1,
        requiredFeatures: audio.length ? ["h264", "audio"] : ["h264"],
      },
      diagnostics: [],
    };
  } catch {
    return failure("video-invalid-inspection", "MP4 inspection or full decode failed.");
  }
};
