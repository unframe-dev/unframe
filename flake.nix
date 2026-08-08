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
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # ツールチェイン。旧 mise.toml のツール固定を置換する。
        toolchain = [
          pkgs.nodejs_22
          pkgs.pnpm
          pkgs.go
          pkgs.golangci-lint
          pkgs.dotnet-sdk_8
          pkgs.powershell
          pkgs.git
          pkgs.coreutils
          pkgs.bash
        ];

        # Vite+ の管理ランタイムは NixOS 用にパッチされていないため、
        # Linux では nix-ld 経由で GNU 動的リンカーを使用する。
        # /lib64 の shim 自体は NixOS 側の programs.nix-ld.enable で有効化する。
        nixLdPackages = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.nix-ld ];
        nixLdEnvironment = pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          NIX_LD = pkgs.stdenv.cc.bintools.dynamicLinker;
          NIX_LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
            pkgs.glibc
            pkgs.stdenv.cc.cc
          ];
        };

        # scripts/ の実処理を flake app としてラップする。
        # flake.nix は依存・公開名・接続のみを持ち、ロジックは scripts/ 側にある。
        mkApp =
          { name, script }:
          let
            wrapper = pkgs.writeShellApplication {
              name = "unframe-${name}";
              runtimeInputs = toolchain;
              text = ''
                root="''${REPO_ROOT:-$(git rev-parse --show-toplevel)}"
                exec "''${root}/scripts/${script}" "$@"
              '';
            };
          in
          {
            type = "app";
            program = "${wrapper}/bin/unframe-${name}";
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
            '';
          }
          // nixLdEnvironment
        );

        # 手動で叩く操作。実体は scripts/ にある。
        apps = {
          check = mkApp {
            name = "check";
            script = "ci/check.sh";
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
        };

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
