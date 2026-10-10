import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
  createHash,
} from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp as copy, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { runPresentationCli } from "../../packages/unframe-cli/src/index.js";
import { readBuildGeneration } from "../../packages/unframe-cli/src/filesystem/read-build-generation.js";
import { createAuthorService } from "../../packages/unframe-cli/src/author/service.js";
import { createLocalPreviewService } from "../../packages/unframe-cli/src/author/local-preview.js";
import { createPublicationAuth } from "../../packages/unframe-cli/src/author/publication-auth.js";
import { createLocalPublicationService } from "../../packages/unframe-cli/src/author/publication.js";
import { startAuthorHost } from "../../packages/unframe-cli/src/author/http.js";
import {
  loadAuthorAssets,
  loadUnityPreviewAssets,
} from "../../packages/unframe-cli/src/author/start.js";

import { chromium, expect, type Browser } from "../../app/web/e2e/local-editor-browser.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const state = process.env["UNFRAME_E2E_STATE"];
if (!state) throw new Error("Run nix run .#local-editor-e2e to provision isolated TLS trust.");
const showcase = process.argv.includes("--showcase");
const cp = "https://localhost:19443";
const web = "https://localhost:19445";
const runtimeEndpoint = "https://localhost:19444";
const config = join(state, "wrangler.toml");
const persist = join(state, "persist");
const children: ReturnType<typeof spawn>[] = [];
let host: Awaited<ReturnType<typeof startAuthorHost>> | undefined;
let browser: Browser | undefined;
const privateKey = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
const serviceIdentity = randomBytes(32).toString("hex");
const quote = (value: string) => JSON.stringify(value);
const workerVars = {
  BETTER_AUTH_URL: cp,
  WEB_ORIGIN: web,
  DEVICE_CLIENT_ID: "unframe-local-editor-e2e",
  R2_ACCOUNT_ID: "local-e2e",
  R2_BUCKET_NAME: "unframe-local-editor-e2e",
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
async function execute(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; safeError?: string } = {},
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(options.safeError ?? `${command} failed (${code}): ${output.slice(-4000)}`),
          ),
    );
  });
}
async function start(
  command: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const log = await open(join(state!, `${label}.log`), "a", 0o600);
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  await log.close();
  child.on("error", (error) => console.error(`${label}: ${error.message}`));
  return child;
}
async function waitFor(
  url: string,
  healthy: (response: Response) => boolean = (response) => response.ok,
) {
  for (let attempt = 0; attempt < 120; ++attempt) {
    try {
      if (healthy(await fetch(url, { signal: AbortSignal.timeout(1500) }))) return;
    } catch {
      /* Servers are starting. */
    }
    await pause(500);
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
async function d1(command: string) {
  await execute(
    "pnpm",
    [
      "--filter",
      "@unframe/control-plane",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "unframe-local-editor-e2e",
      "--local",
      "--persist-to",
      persist,
      "--config",
      config,
      "--command",
      command,
    ],
    { safeError: "Local identity fixture setup failed; credentials have been omitted." },
  );
}
async function seedIdentity(globalRole: "admin" | "user") {
  const userId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await d1(
    `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,globalRole,twoFactorEnabled) VALUES ('${userId}','Local E2E','${userId}@localhost.test',1,${now},${now},'${globalRole}',0); INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId,assurance) VALUES ('${randomUUID()}',${now + 3600000},'${token}',${now},${now},'${userId}','google');`,
  );
  return { userId, token };
}
async function remote(path: string, bearer: string, body?: unknown) {
  return fetch(new URL(path, cp), {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
}

try {
  for (const port of [15173, 18887, 19090, 19443, 19444, 19445]) await reservePort(port);
  await writeFile(
    config,
    `name="unframe-local-editor-e2e"\nmain=${quote(join(root, "app/server/control-plane/src/index.ts"))}\ncompatibility_date="2026-08-09"\ncompatibility_flags=["nodejs_compat"]\n[vars]\n${Object.entries(
      workerVars,
    )
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(
        "\n",
      )}\n[[d1_databases]]\nbinding="DB"\ndatabase_name="unframe-local-editor-e2e"\ndatabase_id="00000000-0000-0000-0000-000000000001"\nmigrations_dir=${quote(join(root, "app/server/control-plane/migrations"))}\n[[r2_buckets]]\nbinding="ASSETS"\nbucket_name="unframe-local-editor-e2e"\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(state, ".dev.vars"),
    Object.entries(secrets)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
    { mode: 0o600 },
  );
  await execute("pnpm", [
    "--filter",
    "@unframe/control-plane",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "unframe-local-editor-e2e",
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
  reverse_proxy http://127.0.0.1:18887
}
${runtimeEndpoint} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  reverse_proxy h2c://127.0.0.1:19090
}
${web} {
  bind 127.0.0.1
  tls ${quote(join(state, "server.pem"))} ${quote(join(state, "server-key.pem"))}
  reverse_proxy http://127.0.0.1:15173
}
`,
  );
  await start(
    "pnpm",
    [
      "--filter",
      "@unframe/control-plane",
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "18887",
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
  await waitFor(`${cp}/.well-known/jwks.json`);
  const identity = await seedIdentity("admin");
  const outsider = await seedIdentity("user");
  await start(
    "pnpm",
    [
      "--filter",
      "@unframe/web",
      "exec",
      "vp",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "15173",
      "--strictPort",
    ],
    "approval-web",
    { ...process.env, VITE_CONTROL_PLANE_URL: cp },
  );
  await waitFor(web);
  const project = join(state, "presentation");
  if (showcase) {
    await copy(join(root, "examples/local-editor-showcase"), project, {
      recursive: true,
      filter: (path) => ![".unframe", "dist"].includes(path.split("/").at(-1)!),
    });
    const entry = join(project, "presentation.unframe.tsx");
    const source = await readFile(entry, "utf8");
    assert(source.includes('"showcase-presentation"'));
    await writeFile(
      entry,
      source.replace('"showcase-presentation"', quote(`presentation-${randomUUID()}`)),
    );
  } else {
    assert.equal((await runPresentationCli({ args: ["init", project] })).exitCode, 0);
  }
  await execute("pnpm", ["--filter", "@unframe/web", "build:editor"]);
  const target = { controlPlaneUrl: cp, webOrigin: web, clientId: workerVars.DEVICE_CLIENT_ID };
  const auth = createPublicationAuth(target);
  const previews = createLocalPreviewService(project);
  const assets = await loadAuthorAssets(join(root, "app/web/dist-editor"));
  for (const [path, asset] of await loadUnityPreviewAssets(
    join(root, ".unframe/unity-preview/UnframePreview"),
  ))
    assets.set(path, asset);
  host = await startAuthorHost({
    service: await createAuthorService(project),
    previews,
    assets,
    auth,
    publication: createLocalPublicationService(previews, auth, target),
  });
  const spki = createHash("sha256")
    .update(
      new X509Certificate(await readFile(join(state, "server.pem"))).publicKey.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("base64");
  browser = await chromium.launch({
    executablePath:
      process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ??
      "/etc/profiles/per-user/t4ko/bin/google-chrome",
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader-webgl",
      `--ignore-certificate-errors-spki-list=${spki}`,
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const editor = await context.newPage();
  const secretExposure: string[] = [];
  editor.on("response", async (response) => {
    if (new URL(response.url()).pathname === "/api/publication-auth") {
      const body = await response.text().catch(() => "");
      if (/device_code|access_token|private-bearer/u.test(body))
        secretExposure.push("secret field in public auth status");
    }
  });
  await editor.goto(`${host.origin}/#token=${host.token}`);
  await editor.getByText("表示 mode: dev", { exact: false }).waitFor({ timeout: 180000 });
  await editor.getByRole("button", { name: "本番 build", exact: true }).click();
  await editor.getByText("Dist build 完了。", { exact: false }).waitFor({ timeout: 180000 });
  await editor.getByRole("button", { name: "Dist Preview", exact: true }).click();
  await editor
    .getByRole("button", { name: "公開の認証を開始", exact: true })
    .waitFor({ state: "visible" });
  await expect(editor.getByRole("button", { name: "公開の認証を開始", exact: true })).toBeEnabled({
    timeout: 90000,
  });
  console.log("Real WebGL Dist scene committed; beginning real device approval.");
  await editor.getByRole("button", { name: "公開の認証を開始", exact: true }).click();
  const approvalUrl = await editor
    .getByRole("link", { name: "認証ページを開く" })
    .getAttribute("href");
  assert(approvalUrl && new URL(approvalUrl).origin === web);
  const seeded = await remote("/api/auth/get-session", identity.token);
  assert.equal(seeded.status, 200);
  const cookies = seeded.headers.getSetCookie().map((header) => {
    const [pair] = header.split(";");
    const split = pair!.indexOf("=");
    return {
      name: pair!.slice(0, split),
      value: pair!.slice(split + 1),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };
  });
  assert(cookies.length);
  await context.addCookies(cookies);
  const approval = await context.newPage();
  await approval.goto(approvalUrl);
  await approval.getByRole("button", { name: "コードを確認", exact: true }).click();
  await approval.getByRole("button", { name: "承認する", exact: true }).click();
  await approval.getByText("デバイスの接続を承認しました。").waitFor();
  const publish = editor.getByRole("button", { name: "表示した Dist を公開", exact: true });
  await expect(publish).toBeEnabled({ timeout: 30000 });
  const fixed = await readBuildGeneration(project, { channel: "dist" });
  // Source can move ahead while the committed Dist remains the publication input.
  const sourcePath = join(project, "presentation.unframe.tsx");
  const source = await readFile(sourcePath, "utf8");
  const advancedSource = source.replace(
    showcase ? "Unframe: Present beyond the screen" : "Unframe / M3A",
    "Saved after Dist confirmation",
  );
  assert.notEqual(advancedSource, source);
  await writeFile(sourcePath, advancedSource);
  await publish.click();
  await editor.getByText("公開完了:", { exact: false }).waitFor({ timeout: 90000 });
  assert.equal(secretExposure.length, 0);
  const bearer = auth.credential();
  const presentationId = fixed.artifacts.buildManifest.presentationId;
  const publicationResponse = await remote(
    `/presentations/${encodeURIComponent(presentationId)}/publication`,
    bearer,
  );
  assert.equal(publicationResponse.status, 200);
  const publication = await publicationResponse.json();
  for (const field of ["buildId", "definitionHash", "renderBundleHash", "assetSetHash"] as const)
    assert.equal(publication[field], fixed.artifacts.buildManifest[field]);
  assert.equal(
    (
      await remote("/presentations", outsider.token, {
        id: presentationId,
        name: "Unauthorized reuse",
      })
    ).status,
    403,
  );
  assert.equal(
    (await remote("/presentations", bearer, { id: presentationId, name: "Authorized reuse" }))
      .status,
    201,
  );
  assert.equal(
    (
      await remote(`/presentations/${encodeURIComponent(presentationId)}/publications`, bearer, {
        buildId: publication.buildId,
        expectedPublicationFence: null,
      })
    ).status,
    409,
  );
  await editor.screenshot({ path: join(state, "dist-published.png"), fullPage: true });
  console.log(
    "Local R2 publication hashes, local ID reuse, authorization and stale fence verified.",
  );
  const created = await remote("/sessions", bearer, { presentationId });
  assert.equal(created.status, 201);
  const { session } = await created.json();
  const runtimeId = randomUUID();
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const assigned = await remote(`/sessions/${session.id}/runtime-assignment`, bearer, {
    runtimeId,
    runtimeKind: "Cloud",
    endpoint: runtimeEndpoint,
    presentationRevision: 1,
    leaseExpiresAt: expiresAt,
  });
  assert.equal(assigned.status, 201);
  const assignment = await assigned.json();
  await execute("go", ["build", "-o", join(state, "realtime"), "./cmd/server"], {
    cwd: join(root, "app/server/realtime"),
  });
  await start(join(state, "realtime"), [], "realtime", {
    ...process.env,
    REALTIME_LISTEN_ADDR: "127.0.0.1:19090",
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
  await pause(2000);
  console.log(
    "Running native Unity Editor against real Delivery, HTTPS R2 assets and Realtime streams.",
  );
  const frameDirectory = join(state, "frames");
  const flowFile = join(state, "showcase-flow.json");
  if (showcase) {
    await mkdir(frameDirectory);
    const steps = ["cover", "problem", "system", "workflow", "closing"];
    await writeFile(
      flowFile,
      JSON.stringify(
        {
          durationSeconds: 36,
          framesPerSecond: 24,
          nodeId: "showcase:showcase-node",
          surfaceId: "showcase:showcase-surface",
          initialStepId: "cover",
          initialStateId: "showcase:cover",
          commands: steps.slice(1).map((step, index) => ({
            atSeconds: (index + 1) * 6,
            interactionId: "showcase:next",
            expectedStepId: step,
            expectedStateId: `showcase:${step}`,
            expectedTimelineId: "showcase:focus",
            expectedCueId: `next-${steps[index]}`,
          })),
        },
        null,
        2,
      ),
    );
  }
  await execute(join(root, "scripts/unity/test-native-editor.sh"), showcase ? ["showcase"] : [], {
    env: {
      ...process.env,
      UNFRAME_E2E_CONTROL_PLANE_ORIGIN: cp,
      UNFRAME_E2E_SESSION_ID: session.id,
      UNFRAME_E2E_BEARER: bearer,
      UNFRAME_E2E_CA_FILE: join(state, "ca.pem"),
      UNFRAME_E2E_RESULT_PATH: join(state, "native.json"),
      UNFRAME_E2E_EXPECTED_PUBLICATION_HASH: publication.publicationManifestHash,
      UNFRAME_E2E_EXPECTED_DEFINITION_HASH: publication.definitionHash,
      UNFRAME_E2E_EXPECTED_RENDER_BUNDLE_HASH: publication.renderBundleHash,
      UNFRAME_E2E_EXPECTED_ASSET_SET_HASH: publication.assetSetHash,
      ...(showcase
        ? {
            UNFRAME_SHOWCASE_FLOW_FILE: flowFile,
            UNFRAME_SHOWCASE_FRAME_DIRECTORY: frameDirectory,
          }
        : {}),
    },
    safeError: "Native Editor E2E failed; inspect the private Unity log and test results.",
  });
  const native = JSON.parse(await readFile(join(state, "native.json"), "utf8"));
  assert.equal(native.sessionReady, true);
  assert.equal(native.status, "passed");
  if (showcase) {
    assert.equal(native.frames, 36 * 24);
    assert.equal(native.acceptedCommands.length, 4);
    assert.equal(native.cameraMoved, true);
    assert.equal(native.pacingValidated, true);
    for (const command of native.acceptedCommands) {
      const animatedFrames = native.states.filter(
        (frame: { videoSeconds: number; stepId: string; renderedOpacity: number }) =>
          frame.videoSeconds >= command.videoSeconds &&
          frame.videoSeconds < command.videoSeconds + 1.5 &&
          frame.stepId === command.stepId &&
          frame.renderedOpacity < 0.99,
      );
      assert(
        animatedFrames.length >= 3,
        "Each live Timeline must appear in multiple captured frames.",
      );
    }
    await execute(process.env["UNFRAME_FFMPEG_EXECUTABLE_PATH"] ?? "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      "24",
      "-i",
      join(frameDirectory, "frame-%06d.png"),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      join(state, "showcase.mp4"),
    ]);
  }
  await writeFile(
    join(state, "result.json"),
    JSON.stringify(
      {
        publication,
        native,
        sourceAdvancedAfterDist: true,
        deviceApproval: true,
        credentialsKeptOnHost: true,
        ...(showcase ? { video: "showcase.mp4", framesPerSecond: 24, durationSeconds: 36 } : {}),
      },
      null,
      2,
    ),
  );
  console.log(`Local Editor E2E passed. Evidence: ${join(state, "result.json")}`);
} finally {
  await browser?.close();
  await host?.close();
  for (const child of children.reverse()) {
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already exited. */
      }
  }
}
