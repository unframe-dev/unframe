#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
D="$root/.unframe/media-metadata-spike"
mkdir -p "$D"
for tool in ffmpeg ffprobe; do
  "$tool" -version > "$D/$tool-version.txt"
  if [[ "$(head -n 1 "$D/$tool-version.txt")" != "$tool version 8.1.2 "* ]]; then
    echo "$tool 8.1.2 is required for this recorded experiment" >&2
    exit 1
  fi
done
video=(-f lavfi -i 'testsrc2=size=64x64:rate=5:duration=1')
audio=(-f lavfi -i 'sine=frequency=1000:sample_rate=48000:duration=1')
common=(-hide_banner -loglevel error -nostdin -y)
avc=(-c:v libx264 -profile:v high -level:v 4.1 -pix_fmt yuv420p -threads 1)
ffmpeg "${common[@]}" "${video[@]}" -an "${avc[@]}" "$D/valid-no-audio.mp4"
ffmpeg "${common[@]}" "${video[@]}" "${audio[@]}" -map 0:v -map 1:a "${avc[@]}" -c:a aac -profile:a aac_low -b:a 96k -ac 2 "$D/valid-aac-lc-48k-stereo.mp4"
ffmpeg "${common[@]}" "${video[@]}" -an -c:v libx264 -profile:v high10 -pix_fmt yuv420p10le -threads 1 "$D/video-10bit.mp4"
ffmpeg "${common[@]}" "${video[@]}" -an -c:v libx264 -profile:v high422 -pix_fmt yuv422p -threads 1 "$D/video-422.mp4"
ffmpeg "${common[@]}" "${video[@]}" -an "${avc[@]}" -flags +ilme+ildct -x264-params tff=1 "$D/video-interlaced.mp4"
ffmpeg "${common[@]}" "${video[@]}" -f lavfi -i 'sine=frequency=1000:sample_rate=44100:duration=1' -map 0:v -map 1:a "${avc[@]}" -c:a aac -profile:a aac_low -b:a 96k -ac 2 "$D/audio-44100.mp4"
ffmpeg "${common[@]}" "${video[@]}" "${video[@]}" -map 0:v -map 1:v "${avc[@]}" "$D/multiple-video-tracks.mp4"
ffmpeg "${common[@]}" -i "$D/valid-aac-lc-48k-stereo.mp4" -map 0 -c copy -metadata title='AVC Main Level 1, fake duration 9999' -metadata:s:v:0 profile='Main' -metadata:s:v:0 level='10' -metadata:s:v:0 duration='9999' -metadata:s:a:0 profile='HE-AAC' -metadata:s:a:0 sample_rate='44100' "$D/fake-tags.mp4"
ffmpeg "${common[@]}" -i "$D/valid-aac-lc-48k-stereo.mp4" -map 0 -c copy -movflags +faststart "$D/valid-faststart.mp4"
# Retain the faststart index but cut payload packets inside mdat.
head -c 10000 "$D/valid-faststart.mp4" > "$D/truncated-mdat.mp4"
printf 'not an mp4' > "$D/invalid.mp4"
head -c 256 "$D/valid-aac-lc-48k-stereo.mp4" > "$D/truncated.mp4"
# Five decoded frames whose presentation timestamps span forty seconds.
ffmpeg "${common[@]}" "${video[@]}" -vf 'setpts=50*PTS' -fps_mode vfr -an "${avc[@]}" "$D/sparse-timestamps.mp4"
node "$root/scripts/experiments/media-metadata/inspect.mjs" "$D"
