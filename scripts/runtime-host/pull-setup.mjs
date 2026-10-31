import { execFileSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addNixStoreRoot, findPinnedTool } from "./funnel-launchd-tools.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const shell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const label = "me.un-fra.realtime-updater";

export async function prepareUpdater({ output, deploymentDirectory, home, node, gh, admin }) {
  for (const path of [output, deploymentDirectory, home, node, gh, admin]) {
    if (!isAbsolute(path ?? "")) throw new Error("Updater paths must be absolute.");
  }
  for (const path of [deploymentDirectory, join(deploymentDirectory, "release/runtime-host")]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022)
      throw new Error("Deployment must be owned by the service user and not writable by others.");
  }
  const deployment = JSON.parse(await readFile(join(deploymentDirectory, "config.json"), "utf8"));
  if (deployment.home !== home || !isAbsolute(deployment.envFile ?? ""))
    throw new Error("Funnel deployment does not belong to this user.");
  const envInfo = await lstat(deployment.envFile);
  if (!envInfo.isFile() || envInfo.uid !== process.getuid() || envInfo.mode & 0o077)
    throw new Error("Funnel environment must be private.");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  try {
    await mkdir(join(output, "logs"), { mode: 0o700 });
    await mkdir(join(output, "state"), { mode: 0o700 });
    await copyFile(admin, join(output, "runtime-host-admin"));
    await chmod(join(output, "runtime-host-admin"), 0o700);
    await copyFile(
      join(root, "scripts/runtime-host/pull-update.mjs"),
      join(output, "pull-update.mjs"),
    );
    const command = [join(output, "runtime-host-admin"), "--deployment", deploymentDirectory];
    await writeFile(
      join(output, "config.json"),
      JSON.stringify(
        {
          repository: "unframe-dev/unframe",
          workflow: "ci.yml",
          directory: join(output, "state"),
          deploymentDirectory,
          gh,
          node,
          activityCommand: [...command, "activity"],
          restartCommand: [...command, "restart"],
          healthCommand: [...command, "health"],
          rollbackHealthCommand: [...command, "rollback-health"],
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(output, "update"),
      `#!/bin/bash
set -euo pipefail
umask 077
export HOME=${shell(home)}
export GH_HOST=github.com
case "\${1:-}" in
  --auto) shift ;;
  --check) ;;
  "") set -- --force ;;
  *) echo 'usage: update [--auto | --check]' >&2; exit 2 ;;
esac
exec ${shell(node)} ${shell(join(output, "pull-update.mjs"))} --config ${shell(join(output, "config.json"))} "$@"
`,
      { mode: 0o700 },
    );
    for (const name of ["stdout.log", "stderr.log"])
      await writeFile(join(output, "logs", name), "", { mode: 0o600 });
    await writeFile(
      join(output, `${label}.plist`),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(join(output, "update"))}</string><string>--auto</string></array>
<key>WorkingDirectory</key><string>${xml(output)}</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>600</integer>
<key>ExitTimeOut</key><integer>180</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(output, "logs/stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(output, "logs/stderr.log"))}</string>
</dict></plist>
`,
      { mode: 0o600 },
    );
    await writeFile(
      join(output, "install.sh"),
      `#!/bin/bash
set -euo pipefail
[ "$(/usr/bin/id -u)" = '${process.getuid()}' ] || { echo 'Install as the service user.' >&2; exit 1; }
control=${shell(join(deploymentDirectory, "update-control"))}
/bin/mkdir -p "$control"
/bin/chmod 700 "$control"
set -a
. ${shell(deployment.envFile)}
set +a
if [ -n "\${REALTIME_HOST_UPDATE_DIRECTORY:-}" ] && [ "$REALTIME_HOST_UPDATE_DIRECTORY" != "$control" ]; then
  echo 'REALTIME_HOST_UPDATE_DIRECTORY points to another deployment.' >&2; exit 1
fi
if [ -z "\${REALTIME_HOST_UPDATE_DIRECTORY:-}" ]; then
  /usr/bin/printf '\\nREALTIME_HOST_UPDATE_DIRECTORY=%s\\n' ${shell(shell(join(deploymentDirectory, "update-control")))} >> ${shell(deployment.envFile)}
fi
agent=${shell(join(home, "Library/LaunchAgents", `${label}.plist`))}
/bin/mkdir -p ${shell(join(home, "Library/LaunchAgents"))}
[ ! -e "$agent" ] && [ ! -L "$agent" ] || { echo 'Updater LaunchAgent already exists.' >&2; exit 1; }
/usr/bin/plutil -lint ${shell(join(output, `${label}.plist`))}
/bin/cp ${shell(join(output, `${label}.plist`))} "$agent"
/bin/chmod 600 "$agent"
/bin/launchctl bootstrap gui/${process.getuid()} "$agent"
`,
      { mode: 0o700 },
    );
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let temporary;
  try {
    if (process.platform !== "darwin" || process.arch !== "arm64" || process.getuid() === 0)
      throw new Error("Run setup as the non-root service user on an arm64 Mac.");
    const [outputArgument, deploymentArgument, flag] = process.argv.slice(2);
    if (process.argv.length > 5 || (flag && flag !== "--install"))
      throw new Error(
        "usage: runtime-host-updater-setup [/absolute/new-updater-directory [/absolute/Funnel [--install]]]",
      );
    const home = process.env.HOME;
    const output =
      outputArgument ?? join(home, "Library/Application Support/Unframe/RealtimeUpdater");
    const deploymentDirectory =
      deploymentArgument ?? join(home, "Library/Application Support/Unframe/Funnel");
    const node = findPinnedTool("node");
    const gh = findPinnedTool("gh");
    execFileSync(gh, ["api", "repos/unframe-dev/unframe/actions/workflows/ci.yml", "--jq", ".id"], {
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, GH_HOST: "github.com" },
    });
    temporary = await mkdtemp(join(tmpdir(), "unframe-updater-"));
    const admin = join(temporary, "runtime-host-admin");
    execFileSync(
      "go",
      [
        "-C",
        join(root, "app/server/realtime"),
        "build",
        "-trimpath",
        "-o",
        admin,
        "./cmd/runtime-host-admin",
      ],
      { stdio: "pipe", timeout: 300000, env: { ...process.env, CGO_ENABLED: "0" } },
    );
    await prepareUpdater({ output, deploymentDirectory, home, node, gh, admin });
    await mkdir(join(output, "nix-roots"), { mode: 0o700 });
    for (const [name, path] of Object.entries({ node, gh })) {
      const store = path.match(/^\/nix\/store\/[^/]+/)?.[0];
      if (!store) throw new Error("Updater tools must come from the pinned Nix environment.");
      addNixStoreRoot(join(output, "nix-roots", name), store);
    }
    if (flag === "--install")
      execFileSync("/bin/bash", [join(output, "install.sh")], { stdio: "inherit" });
    console.log(
      `Prepared updater: ${output}\nInstall: /bin/bash ${shell(join(output, "install.sh"))}\nUpdate immediately: ${shell(join(output, "update"))}\nCheck: ${shell(join(output, "update"))} --check`,
    );
  } catch (error) {
    console.error(
      error.cmd
        ? "Updater preparation command failed; check GitHub authentication and the local deployment."
        : error.message,
    );
    process.exitCode = 1;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
