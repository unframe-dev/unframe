# Presentation reference project

This is the M3A static v2 filesystem Authoring Project acceptance fixture. `unframe.lock` embeds and pins the
minimal `@unframe/unframe-authoring` declaration package and the hashes of the theme and
structured component declarations. It also carries the unchanged Liberation Sans TTF bytes with their
SHA-256 checksum and size; see `FONT-LICENSE.txt`. Generated `.unframe/` and `dist` output are not source.

The surface combines typed Theme tokens and aliases, Text/Frame Named Styles, scalar Props,
a style Variant, a public Part override, and clipped absolute Frame nesting. A Slot placeholder
places a separate Frame-root badge Component inside the card. Both Instances retain their IDs in
the generated content and share one Surface. The placeholder attaches the badge semantic root to the heading through `semanticParentId`. The headline demonstrates style precedence: Named
Style size 56, inline 64, Variant 68, and Part override 72.

The fixture explicitly supplies its defaulted Props and Variant. Omitting `offset`, `showCard`, or
`tone` uses the manifest default and emits a warning; `title` and the badge's `label` are required.

From the repository root, `check` validates the static Authoring Source without starting a Browser.
`build` uses the provisioned Fixed Browser and atomically publishes `definition.json`,
`render-bundle.json`, `asset-set.json`, `build-manifest.json`, and PNG/Font assets through the managed `dist` symlink.

```bash
pnpm --filter @unframe/unframe-cli run presentation -- check "$PWD/examples/presentation"
nix develop --command scripts/dev/install-presentation-browser.sh
nix develop --command env PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" \
  pnpm --filter @unframe/unframe-cli run presentation -- build "$PWD/examples/presentation"
```

`nix run .#presentation` copies this fixture to a temporary project, runs `check`, builds twice over
the existing managed output, and compares every artifact relative path and SHA-256 digest.

Local builds use `sourceDraftRevision: 0`. This build boundary does not create publication or Delivery artifacts.
