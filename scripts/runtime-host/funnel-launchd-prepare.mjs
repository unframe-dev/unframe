import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addNixStoreRoot, findPinnedTool } from "./funnel-launchd-tools.mjs";

const shell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const [output, user, releaseArgument, envArgument] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const home = process.env.HOME;
const release = releaseArgument ?? join(root, ".unframe/realtime-release");
const envFile = envArgument ?? join(home, ".config/unframe/runtime-host.env");
const label = "me.un-fra.realtime-funnel";
const stateDirectory = join(home, ".config/unframe/funnel");
let created = false;
try {
  if (
    process.platform !== "darwin" ||
    process.argv.length > 6 ||
    !output?.startsWith("/") ||
    !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(user ?? "") ||
    existsSync(output) ||
    !release.startsWith("/") ||
    !envFile.startsWith("/")
  ) {
    throw new Error(
      "usage (macOS): runtime-host-funnel-deploy /absolute/new-directory non-root-user [/absolute/release [/absolute/environment]]",
    );
  }
  const uid = Number(execFileSync("/usr/bin/id", ["-u", user], { encoding: "utf8" }).trim());
  if (uid === 0 || uid !== process.getuid())
    throw new Error("Prepare as the non-root service user.");
  const registeredHome = execFileSync(
    "/usr/bin/dscl",
    [".", "-read", `/Users/${user}`, "NFSHomeDirectory"],
    { encoding: "utf8" },
  )
    .trim()
    .replace(/^NFSHomeDirectory:\s*/, "");
  if (home !== registeredHome)
    throw new Error("HOME must match the service user's home directory.");
  for (const path of [envFile, stateDirectory]) {
    const info = statSync(path);
    if (info.uid !== uid || (info.mode & 0o077) !== 0)
      throw new Error(
        "Environment and Tailscale state must be private and owned by the service user.",
      );
  }
  const marker = join(stateDirectory, "launchd-owner.json");
  if (existsSync(marker)) {
    const ownership = JSON.parse(readFileSync(marker, "utf8"));
    if (ownership.label !== label || ownership.target !== "127.0.0.1:8443") {
      throw new Error("Existing Tailscale state belongs to another deployment.");
    }
  }
  for (const name of ["runtime-host", "realtime-server"]) {
    if (!(statSync(join(release, name)).mode & 0o111))
      throw new Error("Build the Realtime release before preparing Funnel launchd.");
  }
  const tools = Object.fromEntries(
    ["node", "bash", "tailscale", "tailscaled", "caddy"].map((name) => [
      name,
      findPinnedTool(name),
    ]),
  );
  const storeRoots = Object.fromEntries(
    Object.entries(tools).map(([name, path]) => {
      const match = path.match(/^\/nix\/store\/[^/]+/);
      if (!match) throw new Error(`${name} must come from the pinned Nix environment.`);
      return [name, match[0]];
    }),
  );
  mkdirSync(output, { recursive: true, mode: 0o700 });
  chmodSync(output, 0o700);
  created = true;
  for (const directory of ["bin", "release", "logs", "nix-roots"])
    mkdirSync(join(output, directory), { mode: 0o700 });
  for (const [name, path] of Object.entries(tools)) symlinkSync(path, join(output, "bin", name));
  for (const name of ["stdout.log", "stderr.log"])
    writeFileSync(join(output, "logs", name), "", { mode: 0o600 });
  for (const name of ["runtime-host", "realtime-server"])
    copyFileSync(join(release, name), join(output, "release", name));
  copyFileSync(join(root, "scripts/runtime-host/funnel.sh"), join(output, "funnel.sh"));
  copyFileSync(
    join(root, "scripts/runtime-host/funnel-launchd-start.mjs"),
    join(output, "start.mjs"),
  );
  copyFileSync(
    join(root, "app/server/realtime/ops/Caddyfile.funnel.example"),
    join(output, "Caddyfile"),
  );
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify(
      {
        directory: output,
        home,
        envFile,
        stateDirectory,
        socket: join(stateDirectory, "tailscaled.sock"),
        ...tools,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  writeFileSync(
    join(output, "start.sh"),
    `#!${tools.bash}\nset -euo pipefail\numask 077\nexec ${shell(tools.node)} ${shell(join(output, "start.mjs"))}\n`,
    { mode: 0o700 },
  );
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>UserName</key><string>${xml(user)}</string>
<key>ProgramArguments</key><array><string>${xml(join(output, "start.sh"))}</string></array>
<key>WorkingDirectory</key><string>${xml(output)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
<key>AbandonProcessGroup</key><false/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(output, "logs/stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(output, "logs/stderr.log"))}</string>
</dict></plist>
`;
  writeFileSync(join(output, `${label}.plist`), plist, { mode: 0o600 });
  execFileSync("/usr/bin/plutil", ["-lint", join(output, `${label}.plist`)], { stdio: "pipe" });
  const destination = `/Library/LaunchDaemons/${label}.plist`;
  writeFileSync(
    join(output, "install.sh"),
    `#!/bin/bash
set -euo pipefail
[ "$(/usr/bin/id -u)" = 0 ] || { echo 'Run this installer with sudo.' >&2; exit 1; }
source_plist=${shell(join(output, `${label}.plist`))}
destination=${shell(destination)}
/usr/bin/plutil -lint "$source_plist" >/dev/null
[ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$source_plist")" = ${shell(label)} ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :UserName' "$source_plist")" = ${shell(user)} ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$source_plist")" = ${shell(join(output, "start.sh"))} ]
if [ -e "$destination" ] || [ -L "$destination" ]; then
  [ ! -L "$destination" ] && [ -f "$destination" ] || { echo 'Unexpected existing launchd path.' >&2; exit 1; }
  [ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$destination")" = ${shell(label)} ]
  [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$destination")" = ${shell(join(output, "start.sh"))} ]
fi
stage=$(/usr/bin/mktemp /Library/LaunchDaemons/.unframe-funnel.XXXXXXXX)
trap '/bin/rm -f "$stage"' EXIT
/bin/cp "$source_plist" "$stage"
/usr/sbin/chown root:wheel "$stage"
/bin/chmod 644 "$stage"
/bin/launchctl bootout system/${label} 2>/dev/null || true
/bin/mv -f "$stage" "$destination"
/bin/launchctl bootstrap system "$destination"
/bin/launchctl print system/${label}
`,
    { mode: 0o700 },
  );
  for (const [name, path] of Object.entries(storeRoots)) {
    addNixStoreRoot(join(output, "nix-roots", name), path);
  }
  writeFileSync(
    join(stateDirectory, "launchd-owner.json"),
    JSON.stringify({ label, target: "127.0.0.1:8443" }),
    { mode: 0o600 },
  );
  console.log(
    `Prepared Funnel service: ${output}\nInstall: sudo /bin/bash ${shell(join(output, "install.sh"))}`,
  );
} catch (error) {
  if (created) rmSync(output, { recursive: true, force: true });
  console.error(
    error.cmd ? "Funnel preparation command failed; no deployment was installed." : error.message,
  );
  process.exitCode = 1;
}
