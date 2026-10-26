{
  description = "Unframe monorepo — toolchain and task entrypoints (ADR-0004)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-darwin" ] (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # ツールチェイン。旧 mise.toml のツール固定を置換する。
        toolchain = [
          (pkgs.callPackage ./packages/config/bun.nix { })
          pkgs.nodejs_22
          (pkgs.pnpm.override { nodejs-slim = pkgs.nodejs-slim_22; })
          pkgs.go
          pkgs.golangci-lint
          pkgs.protobuf
          pkgs.protoc-gen-go
          pkgs.protoc-gen-go-grpc
          pkgs.dotnet-sdk_8
          pkgs.openapi-generator-cli
          pkgs.buf
          pkgs.git
          pkgs.git-lfs
          pkgs.coreutils
          pkgs.findutils
          pkgs.gnugrep
          pkgs.gnused
          pkgs.bash
          pkgs.ffmpeg
        ]
        ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.bubblewrap
          pkgs.systemd
          pkgs.xdg-utils
        ];

        # Vite+ の管理ランタイムは NixOS 用にパッチされていないため、
        # Linux では nix-ld 経由で GNU 動的リンカーを使用する。
        # /lib64 の shim 自体は NixOS 側の programs.nix-ld.enable で有効化する。
        nixLdPackages = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.nix-ld ];
        chromiumRuntime = pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.glib
          pkgs.nspr
          pkgs.nss
          pkgs.atk
          pkgs.at-spi2-atk
          pkgs.dbus.lib
          pkgs.libX11
          pkgs.libXcomposite
          pkgs.libXdamage
          pkgs.libXext
          pkgs.libXfixes
          pkgs.libXrandr
          pkgs.libxcb
          pkgs.libgbm
          pkgs.mesa
          pkgs.expat
          pkgs.libxkbcommon
          pkgs.systemd
          pkgs.alsa-lib
          pkgs.fontconfig
          pkgs.noto-fonts-cjk-sans
        ];
        presentationFonts =
          pkgs.runCommand "unframe-presentation-fonts"
            {
              font = pkgs.fetchurl {
                url = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf";
                sha256 = "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5";
              };
              license = pkgs.fetchurl {
                url = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE";
                sha256 = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2";
              };
            }
            ''
              mkdir -p "$out/share/fonts/opentype/unframe"
              cp "$font" "$out/share/fonts/opentype/unframe/NotoSansCJKjp-Regular.otf"
              mkdir -p "$out/share/licenses/unframe-presentation-fonts"
              cp "$license" "$out/share/licenses/unframe-presentation-fonts/LICENSE"
            '';
        presentationFontconfig = pkgs.writeText "unframe-presentation-fontconfig.conf" ''
          <?xml version="1.0"?>
          <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
          <fontconfig>
            <dir>${presentationFonts}/share/fonts</dir>
          </fontconfig>
        '';
        darwinOpaqueLauncher = pkgs.stdenv.mkDerivation {
          pname = "unframe-darwin-opaque";
          version = "4";
          src = ./packages/unframe-worker-host/src/native;
          nativeBuildInputs = [ pkgs.nodejs_22 ];
          dontFixup = true;
          buildPhase = ''
            node compile-policy.ts package --out policies --header darwin-policy-hashes.h
            $CC -std=c11 -O2 -Wall -Wextra darwin-launcher.c -o unframe-darwin-opaque -lsandbox -framework CoreFoundation
          '';
          installPhase = ''
            mkdir -p "$out/bin" "$out/share/unframe-darwin-opaque"
            cp unframe-darwin-opaque "$out/bin/"
            cp compile-policy.ts "$out/share/unframe-darwin-opaque/"
            cp -R chromium "$out/share/unframe-darwin-opaque/"
            cp policies/*.sb "$out/share/unframe-darwin-opaque/"
            /usr/bin/codesign --force --sign - --options runtime,library,restrict "$out/bin/unframe-darwin-opaque"
            /usr/bin/codesign --verify --strict "$out/bin/unframe-darwin-opaque"
          '';
        };
        opaqueRuntimeClosure = pkgs.closureInfo {
          rootPaths = [
            pkgs.nodejs_22
            pkgs.bash
            presentationFontconfig
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.nix-ld
            pkgs.glibc
          ]
          ++ chromiumRuntime
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ darwinOpaqueLauncher ];
        };
        styleRuntimeClosure = pkgs.closureInfo {
          rootPaths = [
            pkgs.nodejs_24
            pkgs.bash
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.nix-ld
            pkgs.glibc
            pkgs.stdenv.cc.cc
          ];
        };
        mediaRuntimeClosure = pkgs.closureInfo {
          rootPaths = [
            pkgs.nodejs_22
            pkgs.bash
            pkgs.ffmpeg
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.nix-ld
            pkgs.glibc
          ];
        };
        runtimeEnvironment = {
          UNFRAME_FFMPEG_PATH = "${pkgs.ffmpeg}/bin/ffmpeg";
          UNFRAME_FFPROBE_PATH = "${pkgs.ffmpeg}/bin/ffprobe";
          UNFRAME_MEDIA_RUNTIME_CLOSURE = "${mediaRuntimeClosure}/store-paths";
          FONTCONFIG_FILE = presentationFontconfig;
          UNFRAME_PRESENTATION_FONT_DIRECTORY = "${presentationFonts}/share/fonts";
          UNFRAME_PRESENTATION_FONT = "${presentationFonts}/share/fonts/opentype/unframe/NotoSansCJKjp-Regular.otf";
          UNFRAME_BASH_PATH = "${pkgs.bash}/bin/bash";
          UNFRAME_STYLE_NODE = "${pkgs.nodejs_24}/bin/node";
          UNFRAME_STYLE_RUNTIME_CLOSURE = "${styleRuntimeClosure}/store-paths";
          UNFRAME_OPAQUE_NODE = "${pkgs.nodejs_22}/bin/node";
          UNFRAME_OPAQUE_RUNTIME_CLOSURE = "${opaqueRuntimeClosure}/store-paths";
          UNFRAME_DARWIN_POLICY_NODE = "${pkgs.nodejs_22}/bin/node";
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin {
          UNFRAME_DARWIN_OPAQUE_LAUNCHER = "${darwinOpaqueLauncher}/bin/unframe-darwin-opaque";
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          NIX_LD = pkgs.stdenv.cc.bintools.dynamicLinker;
          NIX_LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (
            [
              pkgs.glibc
              pkgs.stdenv.cc.cc
            ]
            ++ chromiumRuntime
          );
          UNFRAME_BWRAP_PATH = "${pkgs.bubblewrap}/bin/bwrap";
          UNFRAME_NIX_LD_SHIM = "${pkgs.nix-ld}/bin/nix-ld";
        };

        # scripts/ の実処理を flake app としてラップする。
        # flake.nix は依存・公開名・接続のみを持ち、ロジックは scripts/ 側にある。
        mkApp =
          {
            name,
            script,
            extraRuntimeInputs ? [ ],
          }:
          let
            wrapper = pkgs.writeShellApplication {
              name = "unframe-${name}";
              runtimeInputs = toolchain ++ extraRuntimeInputs;
              text = ''
                ${pkgs.lib.concatStringsSep "\n" (
                  pkgs.lib.mapAttrsToList (
                    variable: value: "export ${variable}=${pkgs.lib.escapeShellArg value}"
                  ) runtimeEnvironment
                )}
                root="''${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
                exec "''${root}/scripts/dev/native-env.sh" "''${root}/scripts/${script}" "$@"
              '';
            };
          in
          {
            type = "app";
            program = "${wrapper}/bin/unframe-${name}";
          };
        unityRuntime =
          if pkgs.stdenv.isDarwin then
            {
              unity-editor = mkApp {
                name = "unity-editor";
                script = "unity/editor.sh";
              };
            }
          else
            {
              unity-editor =
                let
                  runtime =
                    (pkgs.steam.override {
                      extraPkgs = p: [
                        p.gtk3
                        p.atk
                        p.at-spi2-atk
                        p.pango
                        p.cairo
                        p.gdk-pixbuf
                      ];
                    }).run;
                  wrapper = pkgs.writeShellApplication {
                    name = "unframe-unity-editor";
                    runtimeInputs = [
                      runtime
                      pkgs.git
                    ];
                    text = ''
                      root="''${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
                      exec steam-run "''${root}/scripts/unity/editor.sh" "$@"
                    '';
                  };
                in
                {
                  type = "app";
                  program = "${wrapper}/bin/unframe-unity-editor";
                };
            };
      in
      {
        devShells.default = pkgs.mkShell (
          {
            packages = toolchain ++ nixLdPackages;
            # nix develop 突入時に git hooks を有効化する (実体は scripts/dev/install-hooks.sh)。
            shellHook = ''
              root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
              if [ -n "''${root}" ] && [ -x "''${root}/scripts/dev/install-hooks.sh" ]; then
                "''${root}/scripts/dev/install-hooks.sh" || true
              fi
              if [ -n "''${root}" ] && [ -f "''${root}/scripts/lib/native-host.sh" ]; then
                source "''${root}/scripts/lib/native-host.sh"
                configure_native_environment
              fi
            '';
          }
          // runtimeEnvironment
        );

        # 手動で叩く操作。実体は scripts/ にある。
        apps = {
          check = mkApp {
            name = "check";
            script = "ci/check.sh";
          };
          control-plane = mkApp {
            name = "control-plane";
            script = "ci/control-plane.sh";
          };
          presentation = mkApp {
            name = "presentation";
            script = "ci/presentation.sh";
          };
          unity-proto = mkApp {
            name = "unity-proto";
            script = "contracts/generate-unity-proto.sh";
          };
          unity-preview = mkApp {
            name = "unity-preview";
            script = "unity/build-preview.sh";
          };
          local-editor-e2e = mkApp {
            name = "local-editor-e2e";
            script = "local-editor/e2e.sh";
            extraRuntimeInputs = [
              pkgs.openssl
              pkgs.caddy
              pkgs.ffmpeg
            ];
          };
          presentation-sample = mkApp {
            name = "presentation-sample";
            script = "presentation-sample/serve.sh";
            extraRuntimeInputs = [
              pkgs.openssl
              pkgs.caddy
            ];
          };
          contracts-consumers = mkApp {
            name = "contracts-consumers";
            script = "contracts/generate-consumers.sh";
          };
          realtime = mkApp {
            name = "realtime";
            script = "ci/realtime.sh";
          };
          local-editor = mkApp {
            name = "local-editor";
            script = "ci/local-editor.sh";
          };
          web = mkApp {
            name = "web";
            script = "ci/web.sh";
          };
          lp = mkApp {
            name = "lp";
            script = "ci/lp.sh";
          };
          setup = mkApp {
            name = "setup";
            script = "dev/setup.sh";
          };
          notion-sync = mkApp {
            name = "notion-sync";
            script = "docs/notion-sync.sh";
          };
        }
        // unityRuntime;

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
