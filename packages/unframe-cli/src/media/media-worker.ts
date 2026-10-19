import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const run = (executable: string, args: string[], headers?: Record<string, Set<number>>) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let pending = "";
    let received = 0;
    let failed = false;
    const fail = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(fail, 60_000);
    child.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > 32 * 1024 * 1024) fail();
      else output += chunk.toString("utf8");
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > (headers ? 1024 * 1024 * 1024 : 1024 * 1024)) {
        fail();
        return;
      }
      if (!headers) return;
      pending += chunk.toString("utf8");
      if (pending.length > 1024 * 1024) {
        fail();
        return;
      }
      const lines = pending.split("\n");
      pending = lines.pop()!;
      const fields: Record<string, string> = {
        profile_idc: "profiles",
        level_idc: "levels",
        chroma_format_idc: "chromaFormats",
        bit_depth_luma_minus8: "lumaDepths",
        bit_depth_chroma_minus8: "chromaDepths",
        frame_mbs_only_flag: "frameOnly",
      };
      for (const line of lines) {
        const match =
          /\b(profile_idc|level_idc|chroma_format_idc|bit_depth_luma_minus8|bit_depth_chroma_minus8|frame_mbs_only_flag)\s+.*=\s*(\d+)\s*$/u.exec(
            line,
          );
        if (match) headers[fields[match[1]!]!]!.add(Number(match[2]));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error("video-inspection-failed"));
      else resolve(output);
    });
  });

const lines = createInterface({ input: process.stdin });
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
send({ type: "bootstrap" });
for await (const line of lines) {
  const message = JSON.parse(line) as { type: string };
  if (message.type === "launch") send({ type: "ready" });
  else if (message.type === "capture") {
    try {
      const probe = process.env.UNFRAME_FFPROBE_PATH!;
      const ffmpeg = process.env.UNFRAME_FFMPEG_PATH!;
      const source = "/input/source.mp4";
      const probeJson = await run(probe, [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_packets",
        "-show_streams",
        "-show_format",
        "-show_entries",
        "format=format_name,duration:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,field_order,sample_rate,channels,time_base,start_pts,duration_ts:packet=stream_index,pts,dts,duration:packet_side_data=skip_samples,discard_padding",
        "-of",
        "json",
        source,
      ]);
      const framesJson = await run(probe, [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_frames",
        "-show_entries",
        "frame=media_type,stream_index,pts,width,height,pix_fmt,interlaced_frame,sample_rate,channels",
        "-of",
        "json",
        source,
      ]);
      const headers = Object.fromEntries(
        ["profiles", "levels", "chromaFormats", "lumaDepths", "chromaDepths", "frameOnly"].map(
          (name) => [name, new Set<number>()],
        ),
      );
      await run(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "info",
          "-nostdin",
          "-xerror",
          "-err_detect",
          "explode",
          "-protocol_whitelist",
          "file,pipe",
          "-threads",
          "1",
          "-i",
          source,
          "-map",
          "0:v:0",
          "-c:v",
          "copy",
          "-bsf:v",
          "trace_headers",
          "-an",
          "-f",
          "null",
          "-",
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-threads",
          "1",
          "-f",
          "null",
          "-",
        ],
        headers,
      );
      send({
        type: "result",
        value: {
          probeJson,
          framesJson,
          headersJson: JSON.stringify(
            Object.fromEntries(
              Object.entries(headers).map(([name, values]) => [
                name,
                [...values].sort((a, b) => a - b),
              ]),
            ),
          ),
          fullDecodeSucceeded: true,
        },
      });
    } catch {
      send({ type: "result", value: { fullDecodeSucceeded: false } });
    }
    break;
  }
}
lines.close();
