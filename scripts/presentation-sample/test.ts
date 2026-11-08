import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import { decodeWireMessage } from "../../packages/contracts/src/presentation/wire.ts";
import type { SampleConnection } from "./lifecycle.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const connection: SampleConnection = JSON.parse(
  await readFile(`${root}.unframe/presentation-sample/active-connection.json`, "utf8"),
);
if (Date.parse(connection.expiresAt) <= Date.now())
  throw new Error("Restart the expired local sample.");
const ca = await readFile(connection.caFile);
async function remote(path: string, body?: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(path, connection.controlPlaneOrigin),
      {
        method: body ? "POST" : "GET",
        ca,
        headers: {
          authorization: `Bearer ${connection.credential}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(30000),
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part: Buffer) => parts.push(part));
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve(Buffer.concat(parts));
          else reject(new Error(`Local sample HTTP request failed (${status}).`));
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body ? JSON.stringify(body) : undefined);
  });
}
const path = `/sessions/${connection.sessionId}`;
const session = JSON.parse((await remote(path)).toString());
if (session.state === "Waiting") await remote(`${path}/start`, {});
else if (session.state !== "Presenting") throw new Error("The local sample session has ended.");
const delivery = decodeWireMessage(
  "unframe.delivery.DeliveryManifest",
  await remote(`${path}/delivery`, { capabilityProfileId: "quest-presentation-v2" }),
);
const publication = delivery.publication as Record<string, unknown>;
const child = spawn("bash", ["scripts/unity/test-native-editor.sh", "e2e"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    UNFRAME_E2E_CONTROL_PLANE_ORIGIN: connection.controlPlaneOrigin,
    UNFRAME_E2E_SESSION_ID: connection.sessionId,
    UNFRAME_E2E_BEARER: connection.credential,
    UNFRAME_E2E_CA_FILE: connection.caFile,
    UNFRAME_E2E_RESULT_PATH: `${root}.unframe/local-editor-e2e/logs/sample.json`,
    UNFRAME_E2E_EXPECTED_PUBLICATION_HASH: String(publication.publicationManifestHash),
    UNFRAME_E2E_EXPECTED_DEFINITION_HASH: String(delivery.definitionHash),
    UNFRAME_E2E_EXPECTED_RENDER_BUNDLE_HASH: String(delivery.renderBundleHash),
    UNFRAME_E2E_EXPECTED_ASSET_SET_HASH: String(delivery.assetSetHash),
  },
});
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
