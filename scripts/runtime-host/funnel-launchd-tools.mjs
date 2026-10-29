import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function addNixStoreRoot(root, storePath) {
  // nix-store is a multicall symlink; its invocation name selects the legacy CLI.
  const executable = execFileSync("/usr/bin/which", ["nix-store"], { encoding: "utf8" }).trim();
  return execFileSync(executable, ["--add-root", root, "--indirect", "-r", storePath], {
    stdio: "pipe",
  });
}

export function findPinnedTool(name) {
  const path = execFileSync("/usr/bin/which", [name], { encoding: "utf8" }).trim();
  const target = realpathSync(path);
  const executable = join(dirname(target), basename(path));
  if (realpathSync(executable) !== target)
    throw new Error(`Cannot preserve the invocation name of ${name}.`);
  return executable;
}
