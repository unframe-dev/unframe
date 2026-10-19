#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
# Stock Playwright Chromium needs libraries beyond the existing Web dev shell.
spike_libs="$(nix eval --raw --impure --expr 'let f = builtins.getFlake ("git+file://" + toString ./.); p = import f.inputs.nixpkgs { system = builtins.currentSystem; }; in p.lib.makeLibraryPath [ p.cups p.cairo p.pango ]')"
export MEDIA_VIDEO_EXTRA_LIBS="$spike_libs"
exec nix develop --command bash -c 'export LD_LIBRARY_PATH="$NIX_LD_LIBRARY_PATH:$MEDIA_VIDEO_EXTRA_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; exec node scripts/experiments/media-video/browser-check.mjs'
