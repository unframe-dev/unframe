import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const directory = path.resolve(process.argv[2]);
const names = [
  "valid-no-audio",
  "valid-aac-lc-48k-stereo",
  "video-10bit",
  "video-422",
  "video-interlaced",
  "audio-44100",
  "multiple-video-tracks",
  "fake-tags",
  "valid-faststart",
  "truncated-mdat",
  "invalid",
  "truncated",
  "sparse-timestamps",
];
const run = (tool, args) => {
  const result = spawnSync(tool, args, {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const results = {};
for (const name of names) {
  const file = path.join(directory, name + ".mp4");
  const bytes = readFileSync(file);
  const probe = run("ffprobe", [
    "-v",
    "error",
    "-show_error",
    "-show_entries",
    "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,bits_per_raw_sample,field_order,sample_rate,channels,duration,nb_frames:format_tags=title",
    "-of",
    "json",
    file,
  ]);
  const decode = run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-xerror",
    "-err_detect",
    "explode",
    "-i",
    file,
    "-map",
    "0",
    "-f",
    "null",
    "-",
  ]);
  writeFileSync(path.join(directory, name + ".probe.json"), probe.stdout);
  writeFileSync(path.join(directory, name + ".probe.log"), probe.stderr);
  writeFileSync(path.join(directory, name + ".decode.log"), decode.stderr);
  const data = JSON.parse(probe.stdout);
  const { streams = [], format = {} } = data;
  results[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    probeExit: probe.status,
    fullDecodeExit: decode.status,
    formatDuration: format.duration ?? null,
    ...(format.tags?.title ? { formatTitle: format.tags.title } : {}),
    streams: streams.map(
      ({
        index,
        codec_type,
        codec_name,
        profile,
        level,
        pix_fmt,
        bits_per_raw_sample,
        field_order,
        sample_rate,
        channels,
        duration,
        nb_frames,
      }) => ({
        index,
        codec_type,
        codec_name,
        profile,
        level,
        pix_fmt,
        bits_per_raw_sample,
        field_order,
        sample_rate,
        channels,
        duration,
        nb_frames,
      }),
    ),
  };
}
const video = (name) => results[name].streams.find((s) => s.codec_type === "video");
const audio = (name) => results[name].streams.find((s) => s.codec_type === "audio");
for (const name of names.filter((n) => !["invalid", "truncated", "truncated-mdat"].includes(n))) {
  assert.equal(results[name].probeExit, 0, name + ": probe failed");
  assert.equal(results[name].fullDecodeExit, 0, name + ": decode failed");
}
assert.equal(results["valid-no-audio"].streams.length, 1);
assert.equal(video("valid-no-audio").profile, "High");
assert.equal(video("valid-no-audio").level, 41);
assert.equal(video("valid-no-audio").bits_per_raw_sample, "8");
assert.equal(video("valid-no-audio").pix_fmt, "yuv420p");
assert.equal(video("valid-no-audio").field_order, "progressive");
assert.equal(audio("valid-aac-lc-48k-stereo").profile, "LC");
assert.equal(audio("valid-aac-lc-48k-stereo").sample_rate, "48000");
assert.equal(audio("valid-aac-lc-48k-stereo").channels, 2);
assert.equal(video("video-10bit").bits_per_raw_sample, "10");
assert.equal(video("video-10bit").pix_fmt, "yuv420p10le");
assert.equal(video("video-422").pix_fmt, "yuv422p");
assert.equal(video("video-interlaced").field_order, "tt");
assert.equal(audio("audio-44100").sample_rate, "44100");
assert.equal(
  results["multiple-video-tracks"].streams.filter((s) => s.codec_type === "video").length,
  2,
);
assert.equal(results["fake-tags"].formatTitle, "AVC Main Level 1, fake duration 9999");
assert.equal(video("fake-tags").profile, "High");
assert.equal(video("fake-tags").level, 41);
assert.equal(audio("fake-tags").profile, "LC");
assert.equal(audio("fake-tags").sample_rate, "48000");
assert.equal(results["fake-tags"].formatDuration, "1.000000");
assert.equal(results["truncated-mdat"].probeExit, 0);
assert.notEqual(results["truncated-mdat"].fullDecodeExit, 0);
for (const name of ["invalid", "truncated"]) {
  assert.notEqual(results[name].probeExit, 0);
  assert.notEqual(results[name].fullDecodeExit, 0);
}
const frameResult = run("ffprobe", [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_frames",
  "-show_entries",
  "frame=best_effort_timestamp_time,duration_time",
  "-of",
  "json",
  path.join(directory, "sparse-timestamps.mp4"),
]);
assert.equal(frameResult.status, 0);
const frames = JSON.parse(frameResult.stdout).frames;
const frameTiming = frames.map((f) => ({
  pts: Number(f.best_effort_timestamp_time),
  duration: Number(f.duration_time),
}));
assert.equal(frames.length, 5);
assert.deepEqual(
  frameTiming.map((f) => f.pts),
  [0, 10, 20, 30, 40],
);
assert.equal(results["sparse-timestamps"].formatDuration, "40.200000");
results["sparse-timestamps"].decodedFrameTiming = frameTiming;
results["sparse-timestamps"].frameStartSpan = frameTiming.at(-1).pts - frameTiming[0].pts;
results["sparse-timestamps"].maxDecodedFrameEnd = Math.max(
  ...frameTiming.map((f) => f.pts + f.duration),
);
assert.equal(results["sparse-timestamps"].maxDecodedFrameEnd, 50);
writeFileSync(path.join(directory, "sparse-timestamps.frames.json"), frameResult.stdout);
const tools = Object.fromEntries(
  ["ffmpeg", "ffprobe"].map((tool) => [
    tool,
    readFileSync(path.join(directory, tool + "-version.txt"), "utf8").split("\n")[0],
  ]),
);
const report = {
  scope: "Linux x86_64 FFmpeg metadata spike, synthetic 64x64 fixtures",
  tools,
  allAssertionsPassed: true,
  results,
};
writeFileSync(path.join(directory, "results.json"), JSON.stringify(report, null, 2) + "\n");
const compact = {
  measuredAt: "2026-10-19",
  scope: report.scope,
  tools,
  allAssertionsPassed: true,
  cases: Object.entries(results).map(([name, r]) => ({
    name,
    bytes: r.bytes,
    probeExit: r.probeExit,
    fullDecodeExit: r.fullDecodeExit,
    duration: r.formatDuration,
    ...(r.formatTitle ? { title: r.formatTitle } : {}),
    video: r.streams
      .filter((s) => s.codec_type === "video")
      .map((s) => ({
        profile: s.profile,
        level: s.level,
        pixelFormat: s.pix_fmt,
        bits: s.bits_per_raw_sample,
        fieldOrder: s.field_order,
        frames: s.nb_frames,
      })),
    audio: r.streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({ profile: s.profile, rate: s.sample_rate, channels: s.channels })),
  })),
  sparseTiming: {
    frames: frameTiming,
    frameStartSpan: results["sparse-timestamps"].frameStartSpan,
    maxDecodedFrameEnd: results["sparse-timestamps"].maxDecodedFrameEnd,
    containerDuration: results["sparse-timestamps"].formatDuration,
  },
};
writeFileSync(
  path.join(directory, "compact-results.json"),
  JSON.stringify(compact, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      allAssertionsPassed: true,
      fixtures: names.length,
      output: path.relative(process.cwd(), path.join(directory, "results.json")),
      truncatedMdat: {
        probe: results["truncated-mdat"].probeExit,
        decode: results["truncated-mdat"].fullDecodeExit,
      },
      sparseTiming: frameTiming,
    },
    null,
    2,
  ),
);
