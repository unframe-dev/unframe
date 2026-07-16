{
  description = "Unframe monorepo — toolchain and task entrypoints (ADR-0004)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
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
          pkgs.sqlc
          pkgs.golangci-lint
          pkgs.goose
          pkgs.dotnet-sdk_8
          pkgs.powershell
          pkgs.git
          pkgs.coreutils
          pkgs.bash
        ];

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
        devShells.default = pkgs.mkShell {
          packages = toolchain;
          # nix develop 突入時に git hooks を有効化する (実体は scripts/dev/install-hooks.sh)。
          shellHook = ''
            root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
            if [ -n "''${root}" ] && [ -x "''${root}/scripts/dev/install-hooks.sh" ]; then
              "''${root}/scripts/dev/install-hooks.sh" || true
            fi
          '';
        };

        # 手動で叩く操作。実体は scripts/ にある。
        apps = {
          gen = mkApp {
            name = "gen";
            script = "generate/all.sh";
          };
          check = mkApp {
            name = "check";
            script = "ci/check.sh";
          };
          # 領域別の品質処理。引数でモードを取る: 既定 check / `-- fix` で自動修正。
          #   例) nix run .#server        (check)
          #       nix run .#server -- fix (format + lint --fix)
          # fix の結果は autofix.yml が commit する。
          server = mkApp {
            name = "server";
            script = "ci/server.sh";
          };
          web = mkApp {
            name = "web";
            script = "ci/web.sh";
          };
          lp = mkApp {
            name = "lp";
            script = "ci/lp.sh";
          };
          contracts = mkApp {
            name = "contracts";
            script = "ci/contracts.sh";
          };
          drift = mkApp {
            name = "drift";
            script = "ci/drift.sh";
          };
          dev = mkApp {
            name = "dev";
            script = "dev/dev.sh";
          };
          setup = mkApp {
            name = "setup";
            script = "dev/setup.sh";
          };
          migrate = mkApp {
            name = "migrate";
            script = "dev/migrate.sh";
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
