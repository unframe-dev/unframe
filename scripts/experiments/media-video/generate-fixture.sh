#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -hide_banner -y -f lavfi -i 'testsrc2=size=320x180:rate=30:duration=6' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=6' -c:v libx264 -profile:v high -level:v 4.1 -pix_fmt yuv420p -flags +bitexact -g 30 -c:a aac -profile:a aac_low -b:a 96k -ar 48000 -ac 2 -map_metadata -1 -movflags +faststart fixtures/video.mp4
ffprobe -v error -show_format -show_streams -of json fixtures/video.mp4 > fixtures/probe.json
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs";import{createHash}from"node:crypto";const b=readFileSync("fixtures/video.mp4");writeFileSync("fixtures/identity.json",JSON.stringify({size:b.length,sha256:createHash("sha256").update(b).digest("hex")},null,2)+"\n")'
