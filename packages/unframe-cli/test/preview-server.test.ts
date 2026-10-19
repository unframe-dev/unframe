import { connect } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startDistPreviewHost } from "../src/author/start.js";
import { writePortableBuild } from "./helpers/portable-dist.js";

it("stops accepting requests and closes incomplete HTTP connections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-preview-close-"));
  await writePortableBuild(directory);
  const server = await startDistPreviewHost(join(directory, "dist"), { assets: new Map() });
  const url = new URL(server.origin);
  const connection = connect(Number(url.port), url.hostname);
  await once(connection, "connect");
  connection.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  connection.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => connection.once("close", () => resolve()));
  try {
    await server.close();
    await closed;
    await expect(fetch(server.origin)).rejects.toThrow();
  } finally {
    connection.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
