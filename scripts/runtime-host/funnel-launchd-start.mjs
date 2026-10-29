import { spawn, execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function ownsServeConfiguration(config, hostname) {
  const keys = Object.keys(config ?? {});
  if (keys.some((key) => !["TCP", "AllowFunnel"].includes(key))) return false;
  const tcp = config?.TCP ?? {};
  if (Object.keys(tcp).length !== 1 || !tcp["443"]) return false;
  if (JSON.stringify(tcp["443"]) !== JSON.stringify({ TCPForward: "127.0.0.1:8443" })) return false;
  const allowed = config?.AllowFunnel ?? {};
  return Object.keys(allowed).every((key) => key === `${hostname}:443` && allowed[key] === true);
}

export function hasListeners(config) {
  return Object.entries(config ?? {}).some(
    ([key, value]) =>
      key !== "AllowFunnel" &&
      value &&
      (typeof value !== "object" || Object.keys(value).length > 0),
  );
}

export async function run(config) {
  const children = new Set();
  let stopping = false;
  let stopResolve;
  const stopRequested = new Promise((resolve) => {
    stopResolve = resolve;
  });
  const requestStop = () => {
    stopping = true;
    stopResolve();
  };
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);
  const pause = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      stopRequested.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  const start = (file, args, env = process.env) => {
    const child = spawn(file, args, { env, stdio: "inherit" });
    children.add(child);
    child.done = new Promise((resolve) => {
      child.once("error", () => resolve({ failed: true }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return child;
  };
  const command = async (args) => {
    const result = await execute(config.tailscale, [`--socket=${config.socket}`, ...args], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  };
  let daemon;
  let funnel;
  try {
    for (const path of [config.stateDirectory, config.envFile]) {
      const info = await stat(path);
      if (info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
        throw new Error(
          "Private state directory and environment must be owned by the service user and inaccessible to others.",
        );
      }
    }
    const ownership = JSON.parse(
      await readFile(join(config.stateDirectory, "launchd-owner.json"), "utf8"),
    );
    if (ownership.label !== "me.un-fra.realtime-funnel" || ownership.target !== "127.0.0.1:8443") {
      throw new Error("Dedicated Funnel state ownership marker does not match.");
    }
    let socket;
    try {
      socket = await stat(config.socket);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (socket) {
      if (!socket.isSocket()) throw new Error("Unexpected file at the Tailscale socket path.");
      let active = false;
      try {
        await command(["status", "--json"]);
        active = true;
      } catch {
        /* A crashed daemon can leave a stale Unix socket. */
      }
      if (active)
        throw new Error("Another tailscaled instance is active; stop it before starting launchd.");
    }
    if (stopping) return;
    daemon = start(config.tailscaled, [
      "--tun=userspace-networking",
      `--statedir=${config.stateDirectory}`,
      `--state=${join(config.stateDirectory, "tailscaled.state")}`,
      `--socket=${config.socket}`,
      "--port=0",
    ]);
    let status;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      if (daemon.exitCode !== null || daemon.signalCode !== null)
        throw new Error("tailscaled stopped before becoming ready.");
      try {
        const candidate = JSON.parse(await command(["status", "--json"]));
        if (candidate.BackendState === "Running") {
          status = candidate;
          break;
        }
      } catch {
        /* The local API is unavailable while tailscaled initializes. */
      }
      await pause(1000);
    }
    if (stopping) return;
    if (!status)
      throw new Error("tailscaled is not authenticated or ready; retrying under launchd.");
    const hostname = status.Self?.DNSName?.replace(/\.$/, "");
    if (!/^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$/.test(hostname ?? ""))
      throw new Error("Invalid Funnel hostname.");
    const serve = JSON.parse(await command(["serve", "status", "--json"]));
    if (hasListeners(serve)) {
      if (!ownsServeConfiguration(serve, hostname))
        throw new Error("Unrecognized Serve configuration; leaving it unchanged.");
      await command(["funnel", "--tcp=443", "off"]);
    }
    if (stopping) return;
    funnel = start(
      config.bash,
      [join(config.directory, "funnel.sh"), join(config.directory, "release"), config.envFile],
      {
        ...process.env,
        HOME: config.home,
        PATH: `${join(config.directory, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
        REPO_ROOT: config.directory,
        TS_SOCKET: config.socket,
        CADDY_CONFIG: join(config.directory, "Caddyfile"),
      },
    );
    const winner = await Promise.race([
      daemon.done.then(() => "daemon"),
      funnel.done.then(() => "funnel"),
      stopRequested.then(() => "stop"),
    ]);
    if (winner !== "stop")
      throw new Error(`${winner} stopped; restarting the complete Funnel service.`);
  } finally {
    for (const child of [funnel, daemon]) {
      if (!child) continue;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      let timer;
      await Promise.race([
        child.done,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 10000);
        }),
      ]);
      clearTimeout(timer);
      children.delete(child);
    }
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const directory = dirname(fileURLToPath(import.meta.url));
  try {
    await run(JSON.parse(await readFile(join(directory, "config.json"), "utf8")));
  } catch (error) {
    // Command failures can include device credentials in their captured output.
    console.error(
      error?.cmd ? "Funnel service command failed; retrying under launchd." : error.message,
    );
    process.exitCode = 1;
  }
}
