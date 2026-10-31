import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { cp as copy, mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { runPresentationCli, publishPresentation } from "../../packages/unframe/cli/src/index.js";
import { readBuildGeneration } from "../../packages/unframe/cli/src/filesystem/read-build-generation.js";
import { advertiseConnection, cleanupSample, samplePorts, sessionExpiry } from "./lifecycle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const state = process.env["UNFRAME_PRESENTATION_SAMPLE_STATE"];
if (!state) throw new Error("Use nix run .#presentation-sample to prepare private TLS trust.");
const sampleDirectory = join(root, ".unframe/presentation-sample");
const activeFile = join(sampleDirectory, "active-connection.json");
const lock = join(sampleDirectory, "active.lock");
const cp = `https://localhost:${samplePorts.controlPlane}`;
const runtimeEndpoint = `https://localhost:${samplePorts.realtime}`;
const config = join(state, "wrangler.toml");
const persist = join(state, "persist");
const database = "unframe-presentation-sample";
const children: ReturnType<typeof spawn>[] = [];
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let ownsLock = false;
let revoke: (() => Promise<void>) | undefined;
let fatal: Error | undefined;
const privateKey = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
const serviceIdentity = randomBytes(32).toString("hex");
const quote = (value: string) => JSON.stringify(value);
const vars = {
  BETTER_AUTH_URL: cp,
  WEB_ORIGIN: cp,
  DEVICE_CLIENT_ID: "unframe-presentation-sample",
  R2_ACCOUNT_ID: "local-sample",
  R2_BUCKET_NAME: database,
  REALTIME_ISSUER: cp,
  REALTIME_AUDIENCE: "unframe-realtime-runtime",
  REALTIME_SIGNING_KID: "local-sample",
  PUBLICATION_ASSET_ORIGIN: cp,
};
const secrets = {
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  BETTER_AUTH_API_KEY: "local-sample-unused",
  GOOGLE_CLIENT_ID: "local-sample-disabled",
  GOOGLE_CLIENT_SECRET: "local-sample-disabled",
  RESEND_API_KEY: "local-sample-unused",
  AUTH_EMAIL_FROM: "sample@localhost.test",
  R2_ACCESS_KEY_ID: "local-sample-unused",
  R2_SECRET_ACCESS_KEY: "local-sample-unused",
  REALTIME_SIGNING_JWK: JSON.stringify(privateKey),
  SERVICE_IDENTITY_SECRET: serviceIdentity,
};
async function execute(command: string, args: string[], cwd = root) {
  cancellation.signal.throwIfAborted();
  const log = await open(join(state!, "setup.log"), "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        signal: cancellation.signal,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Sample setup failed; inspect the private setup log.")),
      );
    });
  } finally {
    await log.close();
  }
}
async function start(command: string, args: string[], label: string, env = process.env) {
  cancellation.signal.throwIfAborted();
  const log = await open(join(state!, `${label}.log`), "a", 0o600);
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  await log.close();
  const failed = () => {
    if (!cancellation.signal.aborted) {
      fatal = new Error(`${label} stopped; inspect its private run log.`);
      stop();
    }
  };
  child.once("error", failed);
  child.once("exit", failed);
}
async function waitFor(probe: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 120; attempt++) {
    cancellation.signal.throwIfAborted();
    try {
      if (await probe()) return;
    } catch {
      /* Services are starting. */
    }
    await pause(500, undefined, { signal: cancellation.signal });
  }
  throw new Error("Local service did not become ready; inspect the private run logs.");
}
async function reservePort(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function remote(path: string, bearer: string, body?: unknown) {
  const response = await fetch(new URL(path, cp), {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok) throw new Error(`Sample API request failed (${response.status}).`);
  return response;
}
try {
  await mkdir(sampleDirectory, { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock, { mode: 0o700 });
    ownsLock = true;
  } catch {
    throw new Error(
      "A sample launcher already owns active.lock. Stop it before starting another run.",
    );
  }
  await rm(activeFile, { force: true });
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, state }), {
    mode: 0o600,
  });
  for (const port of Object.values(samplePorts)) await reservePort(port);
  await writeFile(
    config,
    `name="${database}"\nmain=${quote(join(root, "app/server/control-plane/src/index.ts"))}\ncompatibility_date="2026-08-09"\ncompatibility_flags=["nodejs_compat"]\n[vars]\n${Object.entries(
      vars,
    )
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(
        "\n",
      )}\n[[d1_databases]]\nbinding="DB"\ndatabase_name="${database}"\ndatabase_id="00000000-0000-0000-0000-000000000002"\nmigrations_dir=${quote(join(root, "app/server/control-plane/migrations"))}\n[[r2_buckets]]\nbinding="ASSETS"\nbucket_name="${database}"\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(state, ".dev.vars"),
    Object.entries(secrets)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
    { mode: 0o600 },
  );
  const wrangler = ["--filter", "@unframe/control-plane", "exec", "wrangler"];
  await execute("pnpm", [
    ...wrangler,
    "d1",
    "migrations",
    "apply",
    database,
    "--local",
    "--persist-to",
    persist,
    "--config",
    config,
  ]);
  await writeFile(
    join(state, "Caddyfile"),
    `{
  admin off
  auto_https off
  log default {
    output discard
  }
}
${cp} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  reverse_proxy http://127.0.0.1:${samplePorts.worker}
}
${runtimeEndpoint} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  reverse_proxy h2c://127.0.0.1:${samplePorts.grpc}
}
`,
  );
  await start(
    "pnpm",
    [
      ...wrangler,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(samplePorts.worker),
      "--persist-to",
      persist,
      "--config",
      config,
      "--log-level",
      "error",
    ],
    "control-plane",
  );
  await start(
    "caddy",
    ["run", "--config", join(state, "Caddyfile"), "--adapter", "caddyfile"],
    "tls",
    {
      ...process.env,
      XDG_DATA_HOME: join(state, "caddy"),
      XDG_CONFIG_HOME: join(state, "caddy-config"),
    },
  );
  await waitFor(
    async () =>
      (await fetch(`${cp}/.well-known/jwks.json`, { signal: AbortSignal.timeout(1500) })).ok,
  );
  const userId = randomUUID();
  const credential = randomBytes(32).toString("hex");
  const now = Date.now();
  const credentialExpiry = now + 60 * 60 * 1000;
  // This admin fixture exists only in this run's isolated local D1 database.
  await execute("pnpm", [
    ...wrangler,
    "d1",
    "execute",
    database,
    "--local",
    "--persist-to",
    persist,
    "--config",
    config,
    "--command",
    `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,globalRole,twoFactorEnabled) VALUES ('${userId}','Local sample','${userId}@localhost.test',1,${now},${now},'admin',0); INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId,assurance) VALUES ('${randomUUID()}',${credentialExpiry},'${credential}',${now},${now},'${userId}','google');`,
  ]);
  const project = join(state, "presentation");
  await copy(join(root, "examples/presentation"), project, {
    recursive: true,
    filter: (path) => !["dist", ".unframe"].includes(path.split("/").at(-1)!),
  });
  console.log("Compiling examples/presentation with the production compiler.");
  const built = await runPresentationCli({
    args: ["build", project],
    host: { signal: cancellation.signal },
  });
  await writeFile(join(state, "compiler.log"), built.stdout + built.stderr, { mode: 0o600 });
  if (built.exitCode !== 0)
    throw new Error("Sample compilation failed; inspect the private compiler log.");
  const fixed = await readBuildGeneration(project, { channel: "dist" });
  const { presentationId, buildId } = fixed.artifacts.buildManifest;
  const published = await publishPresentation({
    directory: join(project, "dist"),
    presentationId,
    controlPlaneUrl: cp,
    bearerToken: credential,
    signal: cancellation.signal,
  });
  if (!published.ok) throw new Error(`Sample publication failed (${published.code}).`);
  const { session } = (await (
    await remote("/sessions", credential, { presentationId })
  ).json()) as { session: { id: string } };
  const runtimeId = randomUUID();
  const leaseExpiry = Date.now() + 20 * 60 * 1000;
  const assignment = (await (
    await remote(`/sessions/${session.id}/runtime-assignment`, credential, {
      runtimeId,
      runtimeKind: "Cloud",
      endpoint: runtimeEndpoint,
      presentationRevision: 1,
      leaseExpiresAt: new Date(leaseExpiry).toISOString(),
    })
  ).json()) as { assignmentEpoch: number; issuedAt: string; leaseExpiresAt: string };
  await execute(
    "go",
    ["build", "-o", join(state, "realtime"), "./cmd/server"],
    join(root, "app/server/realtime"),
  );
  await start(join(state, "realtime"), [], "realtime", {
    ...process.env,
    REALTIME_LISTEN_ADDR: `127.0.0.1:${samplePorts.grpc}`,
    REALTIME_ISSUER: cp,
    REALTIME_AUDIENCE: "unframe-realtime-runtime",
    REALTIME_JWKS_URL: `${cp}/.well-known/jwks.json`,
    REALTIME_CONTROL_PLANE_URL: cp,
    REALTIME_SERVICE_IDENTITY: serviceIdentity,
    REALTIME_SESSION_ID: session.id,
    REALTIME_RUNTIME_ID: runtimeId,
    REALTIME_RUNTIME_KIND: "Cloud",
    REALTIME_RUNTIME_ENDPOINT: runtimeEndpoint,
    REALTIME_ASSIGNMENT_EPOCH: String(assignment.assignmentEpoch),
    REALTIME_PRESENTATION_REVISION: "1",
    REALTIME_ASSIGNMENT_ISSUED_AT: assignment.issuedAt,
    REALTIME_LEASE_EXPIRES_AT: assignment.leaseExpiresAt,
  });
  await waitFor(
    () =>
      new Promise<boolean>((resolve) => {
        const socket = createConnection({ port: samplePorts.grpc, host: "127.0.0.1" });
        socket.setTimeout(1000);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
      }),
  );
  await remote(`/sessions/${session.id}/delivery`, credential, {
    capabilityProfileId: "quest-presentation-v2",
  });
  await remote(`/sessions/${session.id}/bootstrap`, credential, {});
  const expiresAt = sessionExpiry(
    Date.now(),
    credentialExpiry,
    Date.parse(assignment.leaseExpiresAt),
  );
  cancellation.signal.throwIfAborted();
  revoke = await advertiseConnection(activeFile, {
    version: 1,
    controlPlaneOrigin: cp,
    sessionId: session.id,
    credential,
    caFile: join(state, "ca.pem"),
    expiresAt,
    advanceLogicalEvent: "",
    presentationId,
    buildId,
  });
  console.log(`Sample ready for Unity Editor. Connection file: ${activeFile}`);
  console.log(
    `Expires: ${expiresAt}. Keep this command running; Ctrl+C stops all sample services.`,
  );
  try {
    await pause(Date.parse(expiresAt) - Date.now(), undefined, { signal: cancellation.signal });
  } catch {
    /* Shutdown or a service failure. */
  }
  if (!cancellation.signal.aborted)
    console.log("Sample lease expired. Run the command again for a new session.");
  if (fatal) throw fatal;
} catch (error) {
  if (!cancellation.signal.aborted || fatal) {
    console.error(
      fatal?.message ?? (error instanceof Error ? error.message : "Sample setup failed."),
    );
    process.exitCode = 1;
  }
} finally {
  stop();
  const cleaned = await cleanupSample(
    async () => {
      await revoke?.();
    },
    async () => {
      for (const child of children.reverse()) {
        if (child.pid)
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            /* Already stopped. */
          }
      }
      for (const child of children) {
        if (child.exitCode !== null || !child.pid) continue;
        await Promise.race([
          new Promise<void>((resolve) => child.once("exit", () => resolve())),
          pause(1500),
        ]);
        if (child.exitCode === null)
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* Already stopped. */
          }
      }
    },
    async () => {
      try {
        if (ownsLock) await rm(lock, { recursive: true, force: true });
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
    },
  );
  if (!cleaned) {
    console.error("Sample shutdown was incomplete; inspect the private run directory.");
    process.exitCode = 1;
  }
}
