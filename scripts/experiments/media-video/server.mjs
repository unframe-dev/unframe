import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const player = path.resolve(root, "../../../.unframe/media-video-spike/player");
const contentTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let body;
    let type;
    if (url.pathname === "/asset.mp4") {
      if (req.headers.authorization !== "Bearer local-spike-fixture") {
        res.writeHead(401);
        res.end();
        return;
      }
      body = url.searchParams.has("invalid")
        ? Buffer.from("invalid media bytes")
        : await readFile(path.join(root, "fixtures/video.mp4"));
      type = "video/mp4";
    } else if (url.pathname === "/identity.json") {
      const invalid = Buffer.from("invalid media bytes");
      body = url.searchParams.has("invalid")
        ? JSON.stringify({
            size: invalid.length,
            sha256: createHash("sha256").update(invalid).digest("hex"),
          })
        : await readFile(path.join(root, "fixtures/identity.json"));
      type = "application/json";
    } else {
      const base = url.pathname.startsWith("/player/") ? player : root;
      const relative = url.pathname.startsWith("/player/")
        ? url.pathname.slice(8)
        : url.pathname === "/"
          ? "index.html"
          : url.pathname.slice(1);
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      body = await readFile(file);
      type = contentTypes[path.extname(file)] ?? "application/octet-stream";
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(Number(process.env.PORT ?? 5188), "127.0.0.1", () =>
  console.log("video spike http://127.0.0.1:5188"),
);
