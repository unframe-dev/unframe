import { connect } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { startPreviewServer } from "../src/process/preview.js";

it("stops accepting requests and closes incomplete HTTP connections", async () => {
  const server = await startPreviewServer("<p>Preview</p>", new Map());
  const url = new URL(server.origin);
  const connection = connect(Number(url.port), url.hostname);
  await once(connection, "connect");
  connection.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  connection.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => connection.once("close", () => resolve()));
  try {
    await server[Symbol.asyncDispose]();
    await closed;
    await expect(fetch(server.origin)).rejects.toThrow();
  } finally {
    connection.destroy();
    await server[Symbol.asyncDispose]();
  }
});
