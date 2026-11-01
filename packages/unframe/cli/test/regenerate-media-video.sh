#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'testsrc=size=64x64:rate=10:duration=2' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=2' \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 32k -map_metadata -1 -movflags +faststart \
  "${root}/packages/unframe/cli/test/fixtures/media-project/video.mp4"
