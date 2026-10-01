{
  bun,
  fetchurl,
  stdenvNoCC,
}:

# Bun 1.3.13 double-closes child_process extra pipes during GC, invalidating
# descriptors reused by artifact publication. Keep the other toolchain pins.
# https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/js/node/child_process.ts#L1364-L1374
bun.overrideAttrs (
  final: previous: {
    version = "1.4.2";
    passthru = previous.passthru // {
      sources = {
        aarch64-darwin = fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${final.version}/bun-darwin-aarch64.zip";
          hash = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8=";
        };
        aarch64-linux = fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${final.version}/bun-linux-aarch64.zip";
          hash = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac=";
        };
        x86_64-linux = fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${final.version}/bun-linux-x64.zip";
          hash = "sha256-NjaPrvdSeHXV/6UuU81IAhdB8qg+tiCKjdZAaNQiqRM=";
        };
      };
    };
    src = final.passthru.sources.${stdenvNoCC.hostPlatform.system};
  }
)
