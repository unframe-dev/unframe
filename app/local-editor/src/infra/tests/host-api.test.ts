// @vitest-environment node
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { createHostApi } from "../host-api";
const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
});
async function host(body: unknown, status = 200) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return createHostApi("secret", { baseUrl: `http://127.0.0.1:${address.port}` });
}
it("rejects a malformed project instead of trusting the TypeScript response type", async () => {
  const api = await host({ revision: "r", instances: [] });
  await expect(api.project()).rejects.toMatchObject({ code: "invalid-response" });
});
it("keeps Host error code and status", async () => {
  const api = await host({ code: "stale", message: "Revision changed" }, 409);
  await expect(api.project()).rejects.toMatchObject({
    status: 409,
    code: "stale",
    message: "Revision changed",
  });
});
it("cancels an HTTP read with the caller lifetime", async () => {
  const api = await host({});
  const abort = new AbortController();
  abort.abort();
  await expect(api.project(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
});
it("rejects invalid nested playback clock values", async () => {
  const api = await host({
    mode: "normal",
    inspection: null,
    occurrences: [],
    state: { requestId: "r", sequence: "1", clock: { runtimeTimeMs: { bad: true } } },
    inputs: [],
    groupId: "g",
    stepId: "s",
    ended: false,
  });
  await expect(api.playback({ requestId: "r", command: "poll" })).rejects.toMatchObject({
    code: "invalid-response",
  });
});
