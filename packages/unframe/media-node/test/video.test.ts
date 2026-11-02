import { describe, expect, it } from "vitest";
import { validateMp4Inspection } from "../src/index.js";

const inspection = () => ({
  sourceId: "video",
  bytes: Uint8Array.of(
    0,
    0,
    0,
    20,
    102,
    116,
    121,
    112,
    105,
    115,
    111,
    109,
    0,
    0,
    0,
    0,
    105,
    115,
    111,
    109,
  ),
  probeJson: JSON.stringify({
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.000000" },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        codec_tag_string: "avc1",
        profile: "High",
        level: 41,
        width: 64,
        height: 64,
        pix_fmt: "yuv420p",
        field_order: "progressive",
        time_base: "1/10",
        start_pts: 0,
        duration_ts: 10,
      },
    ],
    packets: [
      { stream_index: 0, pts: 0, dts: 0, duration: 5 },
      { stream_index: 0, pts: 5, dts: 5, duration: 5 },
    ],
  }),
  framesJson: JSON.stringify({
    frames: [
      {
        media_type: "video",
        stream_index: 0,
        pts: 0,
        width: 64,
        height: 64,
        pix_fmt: "yuv420p",
        interlaced_frame: 0,
      },
      {
        media_type: "video",
        stream_index: 0,
        pts: 5,
        width: 64,
        height: 64,
        pix_fmt: "yuv420p",
        interlaced_frame: 0,
      },
    ],
  }),
  headersJson: JSON.stringify({
    profiles: [100],
    levels: [41],
    chromaFormats: [1],
    lumaDepths: [0],
    chromaDepths: [0],
    frameOnly: [1],
  }),
  fullDecodeSucceeded: true,
});

const audioInspection = (discardPadding?: number) => {
  const input = inspection();
  const probe = JSON.parse(input.probeJson);
  probe.streams.push({
    index: 1,
    codec_type: "audio",
    codec_name: "aac",
    profile: "LC",
    sample_rate: "48000",
    channels: 2,
    time_base: "1/48000",
    start_pts: 0,
    duration_ts: 48000,
  });
  const packets = Array.from({ length: 47 }, (_, index) => ({
    stream_index: 1,
    pts: index * 1024,
    dts: index * 1024,
    duration: Math.min(1024, 48000 - index * 1024),
  }));
  probe.packets.push(...packets);
  if (discardPadding !== undefined)
    probe.packets.at(-1).side_data_list = [{ discard_padding: discardPadding }];
  input.probeJson = JSON.stringify(probe);
  const frames = JSON.parse(input.framesJson);
  frames.frames.push(
    ...packets.map(({ pts }) => ({
      media_type: "audio",
      stream_index: 1,
      pts,
      sample_rate: "48000",
      channels: 2,
    })),
  );
  input.framesJson = JSON.stringify(frames);
  return input;
};

describe("MP4 inspection", () => {
  it("derives integer duration and codec requirements from inspected source bytes", () => {
    expect(validateMp4Inspection(inspection())).toMatchObject({
      valid: true,
      value: {
        mediaType: "video/mp4",
        codec: "h264",
        encodedSizeBytes: 20,
        durationMilliseconds: 1000,
        pixelSize: [64, 64],
        alpha: false,
        audio: false,
        requiredFeatures: ["h264"],
      },
    });
  });
  it.each(["avc3", "hvc1", "", undefined])(
    "rejects a video sample entry unsupported by Unity: %s",
    (sampleEntry) => {
      const input = inspection();
      const probe = JSON.parse(input.probeJson);
      probe.streams[0].codec_tag_string = sampleEntry;
      input.probeJson = JSON.stringify(probe);
      expect(validateMp4Inspection(input)).toMatchObject({
        valid: false,
        diagnostics: [{ code: "video-codec-unsupported" }],
      });
    },
  );
  it("rejects a container duration that disagrees with the presentation end", () => {
    const input = inspection();
    const probe = JSON.parse(input.probeJson);
    probe.format.duration = "2.000000";
    input.probeJson = JSON.stringify(probe);
    expect(validateMp4Inspection(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "video-timing-invalid" }],
    });
  });
  it("accepts reordered packet PTS while decoded frame PTS stays ordered", () => {
    const input = inspection();
    const probe = JSON.parse(input.probeJson);
    probe.packets = [
      { stream_index: 0, pts: 5, dts: -5, duration: 5 },
      { stream_index: 0, pts: 0, dts: 0, duration: 5 },
    ];
    input.probeJson = JSON.stringify(probe);
    expect(validateMp4Inspection(input)).toMatchObject({
      valid: true,
      value: { durationMilliseconds: 1000 },
    });
  });
  it("rejects sparse packet intervals that extend beyond the declared track", () => {
    const input = inspection();
    const probe = JSON.parse(input.probeJson);
    probe.packets[0].duration = 50;
    input.probeJson = JSON.stringify(probe);
    expect(validateMp4Inspection(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "video-timing-invalid" }],
    });
  });
  it.each([
    ["without decoder padding", undefined],
    ["with decoder padding", 128],
  ] as const)("accepts shortened AAC packet duration %s", (_name, padding) => {
    expect(validateMp4Inspection(audioInspection(padding))).toMatchObject({
      valid: true,
      value: { durationMilliseconds: 1000, audio: true },
    });
  });
  it.each([895, 897, 1024])(
    "rejects an AAC packet end mismatch even with decoder padding: %i ticks",
    (duration) => {
      const input = audioInspection(128);
      const probe = JSON.parse(input.probeJson);
      probe.packets.at(-1).duration = duration;
      input.probeJson = JSON.stringify(probe);
      expect(validateMp4Inspection(input)).toMatchObject({
        valid: false,
        diagnostics: [{ code: "video-timing-invalid" }],
      });
    },
  );
  it("rejects decoder padding on a video packet", () => {
    const input = inspection();
    const probe = JSON.parse(input.probeJson);
    probe.packets.at(-1).side_data_list = [{ discard_padding: 1 }];
    input.probeJson = JSON.stringify(probe);
    expect(validateMp4Inspection(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "video-timing-invalid" }],
    });
  });
  it.each(["profiles", "levels", "chromaFormats", "lumaDepths", "frameOnly"])(
    "rejects a later incompatible AVC sequence header: %s",
    (field) => {
      const input = inspection();
      const headers = JSON.parse(input.headersJson);
      headers[field].push(99);
      input.headersJson = JSON.stringify(headers);
      expect(validateMp4Inspection(input)).toMatchObject({
        valid: false,
        diagnostics: [{ code: "video-codec-unsupported" }],
      });
    },
  );
  it("rejects a midstream decoded geometry change", () => {
    const input = inspection();
    const frames = JSON.parse(input.framesJson);
    frames.frames[1].width = 128;
    input.framesJson = JSON.stringify(frames);
    expect(validateMp4Inspection(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "video-codec-unsupported" }],
    });
  });
  it("refuses a successful probe when full decode failed", () => {
    expect(validateMp4Inspection({ ...inspection(), fullDecodeSucceeded: false })).toMatchObject({
      valid: false,
    });
  });
  it("does not evaluate accessors on the inspection envelope", () => {
    let reads = 0;
    const input = inspection();
    Object.defineProperty(input, "probeJson", {
      get() {
        reads++;
        throw new Error("do not read");
      },
    });
    expect(validateMp4Inspection(input)).toMatchObject({ valid: false });
    expect(reads).toBe(0);
  });
});
