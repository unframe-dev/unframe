import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { cp as copy, open, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { audienceWebCapabilityProfileId } from "../../packages/contracts/src/presentation/index.js";
import { publishPresentation, runPresentationCli } from "../../packages/unframe-cli/src/index.js";
import { readBuildGeneration } from "../../packages/unframe-cli/src/filesystem/read-build-generation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const state = process.env["UNFRAME_REALTIME_E2E_STATE"];
if (!state) throw new Error("Use nix run .#realtime-e2e to prepare private TLS trust.");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--race") || args.length > 1)
  throw new Error("Usage: nix run .#realtime-e2e -- [--race]");
const race = args.includes("--race") ? ["-race"] : [];
const cancellation = new AbortController();
const children: ReturnType<typeof spawn>[] = [];
const stop = () => cancellation.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let fatal: Error | undefined;
const quote = (value: string) => JSON.stringify(value);

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate a local port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function launch(
  command: string,
  args: string[],
  label: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; service?: boolean; terminal?: boolean } = {},
) {
  cancellation.signal.throwIfAborted();
  const log = options.terminal ? null : await open(join(state!, `${label}.log`), "a", 0o600);
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    detached: true,
    stdio: log ? ["ignore", log.fd, log.fd] : ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const completion = new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new Error("Realtime E2E interrupted."));
    cancellation.signal.addEventListener("abort", aborted, { once: true });
    const finish = (error?: Error) => {
      cancellation.signal.removeEventListener("abort", aborted);
      if (options.service && !cancellation.signal.aborted) {
        fatal = error ?? new Error(`${label} stopped unexpectedly.`);
        stop();
      }
      if (error) reject(error);
      else resolve();
    };
    child.once("error", () =>
      finish(new Error(`${label} could not start; inspect its private log.`)),
    );
    child.once("exit", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              options.terminal
                ? `${label} failed (exit ${code ?? "signal"}); see the test output above.`
                : `${label} failed; inspect ${state}/${label}.log.`,
            ),
      ),
    );
  });
  void completion.catch(() => {});
  await log?.close();
  if (!options.service) await completion;
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
  throw new Error("Local services did not become ready; inspect the private run logs.");
}

async function stopChildren() {
  for (const child of children.toReversed()) {
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* The process group has already stopped. */
      }
  }
  for (const child of children.toReversed()) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      pause(1500),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* The process group has already stopped. */
      }
  }
  for (const child of children.toReversed()) {
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* A descendant can outlive its process-group leader. */
      }
  }
}

try {
  const allocated = new Set<number>();
  while (allocated.size < 6) allocated.add(await availablePort());
  const [controlPlanePort, runtimePort, audiencePort, workerPort, grpcPort, audienceVitePort] = [
    ...allocated,
  ];
  const cp = `https://localhost:${controlPlanePort}`;
  const runtimeEndpoint = `https://localhost:${runtimePort}`;
  const audienceOrigin = `https://localhost:${audiencePort}`;
  const config = join(state, "wrangler.toml");
  const persist = join(state, "persist");
  const database = "unframe-realtime-e2e";
  const serviceIdentity = randomBytes(32).toString("hex");
  const privateKey = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const vars = {
    BETTER_AUTH_URL: cp,
    WEB_ORIGIN: cp,
    AUDIENCE_ORIGIN: audienceOrigin,
    DEVICE_CLIENT_ID: database,
    R2_ACCOUNT_ID: "local-e2e",
    R2_BUCKET_NAME: database,
    REALTIME_ISSUER: cp,
    REALTIME_AUDIENCE: "unframe-realtime-runtime",
    REALTIME_SIGNING_KID: "local-e2e",
    PUBLICATION_ASSET_ORIGIN: cp,
  };
  const secrets = {
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    BETTER_AUTH_API_KEY: "local-e2e-unused",
    GOOGLE_CLIENT_ID: "local-e2e-disabled",
    GOOGLE_CLIENT_SECRET: "local-e2e-disabled",
    RESEND_API_KEY: "local-e2e-unused",
    AUTH_EMAIL_FROM: "e2e@localhost.test",
    R2_ACCESS_KEY_ID: "local-e2e-unused",
    R2_SECRET_ACCESS_KEY: "local-e2e-unused",
    REALTIME_SIGNING_JWK: JSON.stringify(privateKey),
    SERVICE_IDENTITY_SECRET: serviceIdentity,
  };
  await writeFile(
    config,
    `name="${database}"\nmain=${quote(join(root, "app/server/control-plane/src/index.ts"))}\ncompatibility_date="2026-08-09"\ncompatibility_flags=["nodejs_compat"]\n[vars]\n${Object.entries(
      vars,
    )
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(
        "\n",
      )}\n[[d1_databases]]\nbinding="DB"\ndatabase_name="${database}"\ndatabase_id="00000000-0000-0000-0000-000000000003"\nmigrations_dir=${quote(join(root, "app/server/control-plane/migrations"))}\n[[r2_buckets]]\nbinding="ASSETS"\nbucket_name="${database}"\n`,
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
  const d1 = ["--local", "--persist-to", persist, "--config", config];
  console.log(`Realtime E2E private run directory: ${state}`);
  await launch("pnpm", [...wrangler, "d1", "migrations", "apply", database, ...d1], "migrations");
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
  reverse_proxy http://127.0.0.1:${workerPort}
}
${runtimeEndpoint} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  handle /browser/* {
    reverse_proxy http://127.0.0.1:${grpcPort}
  }
  handle {
    reverse_proxy h2c://127.0.0.1:${grpcPort}
  }
}
${audienceOrigin} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  handle /__realtime_e2e {
    header Content-Type text/html
    respond "<!doctype html><html><body></body></html>"
  }
  handle {
    reverse_proxy http://127.0.0.1:${audienceVitePort}
  }
}
`,
    { mode: 0o600 },
  );
  await launch(
    "pnpm",
    [
      ...wrangler,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(workerPort),
      "--persist-to",
      persist,
      "--config",
      config,
      "--log-level",
      "error",
    ],
    "control-plane",
    { service: true },
  );
  await launch(
    "caddy",
    ["run", "--config", join(state, "Caddyfile"), "--adapter", "caddyfile"],
    "tls",
    {
      service: true,
      env: {
        ...process.env,
        XDG_DATA_HOME: join(state, "caddy"),
        XDG_CONFIG_HOME: join(state, "caddy-config"),
      },
    },
  );
  await launch(
    "pnpm",
    ["exec", "vite", "--host", "127.0.0.1", "--port", String(audienceVitePort), "--strictPort"],
    "audience",
    {
      service: true,
      cwd: join(root, "app/web/audience"),
    },
  );
  await waitFor(
    async () =>
      (await fetch(`${cp}/.well-known/jwks.json`, { signal: AbortSignal.timeout(1500) })).ok,
  );
  await waitFor(
    async () =>
      (await fetch(`${audienceOrigin}/@vite/client`, { signal: AbortSignal.timeout(1500) })).ok,
  );
  const userId = randomUUID();
  const presenterCredential = randomBytes(32).toString("hex");
  const now = Date.now();
  // Only the login identity is seeded; publication, participation, and assignment use the APIs.
  await launch(
    "pnpm",
    [
      ...wrangler,
      "d1",
      "execute",
      database,
      ...d1,
      "--command",
      `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,globalRole,twoFactorEnabled) VALUES ('${userId}','Realtime E2E','${userId}@localhost.test',1,${now},${now},'admin',0); INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId,assurance) VALUES ('${randomUUID()}',${now + 60 * 60 * 1000},'${presenterCredential}',${now},${now},'${userId}','google');`,
    ],
    "identity",
  );
  const project = join(state, "presentation");
  await copy(join(root, "examples/presentation"), project, {
    recursive: true,
    filter: (path) => !["dist", ".unframe"].includes(path.split("/").at(-1)!),
  });
  console.log("Compiling and publishing examples/presentation through the production CLI.");
  const built = await runPresentationCli({
    args: ["build", project],
    host: { signal: cancellation.signal },
  });
  await writeFile(join(state, "compiler.log"), built.stdout + built.stderr, { mode: 0o600 });
  if (built.exitCode !== 0)
    throw new Error("Compilation failed; inspect the private compiler log.");
  const fixed = await readBuildGeneration(project, { channel: "dist" });
  const { presentationId } = fixed.artifacts.buildManifest;
  const published = await publishPresentation({
    directory: join(project, "dist"),
    presentationId,
    controlPlaneUrl: cp,
    bearerToken: presenterCredential,
    signal: cancellation.signal,
  });
  if (!published.ok) throw new Error(`Publication failed (${published.code}).`);
  const remote = async (path: string, body: unknown) => {
    const response = await fetch(new URL(path, cp), {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${presenterCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new Error(`E2E API request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  };
  const { session, joinCode } = z
    .object({ session: z.object({ id: z.string().min(1) }), joinCode: z.string().min(1) })
    .parse(await remote("/sessions", { presentationId }));
  const runtimeId = randomUUID();
  const assignment = z
    .object({
      assignmentEpoch: z.number().int().positive(),
      issuedAt: z.string().datetime(),
      leaseExpiresAt: z.string().datetime(),
    })
    .parse(
      await remote(`/sessions/${session.id}/runtime-assignment`, {
        runtimeId,
        runtimeKind: "Cloud",
        endpoint: runtimeEndpoint,
        presentationRevision: 1,
        leaseExpiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      }),
    );
  const runtimeBinary = join(state, "realtime");
  await launch("go", ["build", ...race, "-o", runtimeBinary, "./cmd/server"], "runtime-build", {
    cwd: join(root, "app/server/realtime"),
  });
  const e2eConfig = join(state, "config.json");
  await writeFile(
    e2eConfig,
    JSON.stringify(
      {
        controlPlaneOrigin: cp,
        runtimeEndpoint,
        audienceOrigin,
        audienceCapabilityProfileId: audienceWebCapabilityProfileId,
        sessionId: session.id,
        joinCode,
        presenterCredential,
        caFile: join(state, "ca.pem"),
        runtimeBinary,
        stateDirectory: state,
        repositoryRoot: root,
        browserStatusFile: join(state, "browser-status.json"),
        runtimeEnv: {
          ...(race.length ? { GORACE: "halt_on_error=1" } : {}),
          SSL_CERT_FILE: join(state, "ca.pem"),
          REALTIME_LISTEN_ADDR: `127.0.0.1:${grpcPort}`,
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
          REALTIME_BROWSER_ORIGINS: audienceOrigin,
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Running real-service gRPC / WebSocket synchronization and recovery E2E.");
  await launch("go", ["test", ...race, "-count=1", "-v", "-timeout", "3m", "./e2e"], "e2e", {
    cwd: join(root, "app/server/realtime"),
    env: { ...process.env, UNFRAME_REALTIME_E2E_CONFIG: e2eConfig },
    terminal: true,
  });
  console.log("Realtime E2E passed.");
} catch (error) {
  console.error(
    fatal?.message ?? (error instanceof Error ? error.message : "Realtime E2E failed."),
  );
  process.exitCode = 1;
} finally {
  stop();
  await stopChildren();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
