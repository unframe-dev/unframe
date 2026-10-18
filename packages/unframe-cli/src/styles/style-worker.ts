import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { CompileStylesRequest, CompileStylesResult } from "@unframe/unframe-tailwind";

process.env.NODE_ENV = "production";
process.env.TZ = "UTC";
process.env.LANG = "C.UTF-8";
delete process.env.UNFRAME_BROWSER_EXECUTABLE;
const workerRoot = fileURLToPath(new URL("./", import.meta.url));
const workerRoots = [...new Set([workerRoot, `${realpathSync(workerRoot)}/`])];
const projectRoot = fileURLToPath(new URL("./project/", import.meta.url));
process.chdir(projectRoot);

const lines = createInterface({ input: process.stdin });
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
type HostMessage =
  | { type: "launch" }
  | { type: "capture"; input: { entries: string[]; adapterPath: string } };
send({ type: "bootstrap" });
for await (const line of lines) {
  // The host owns the private protocol and validates entries before launching this process.
  const message = JSON.parse(line) as HostMessage;
  if (message.type === "launch") send({ type: "ready" });
  else if (message.type === "capture") {
    try {
      const adapter: {
        compileStyles: (request: CompileStylesRequest) => Promise<CompileStylesResult>;
      } = await import(new URL(message.input.adapterPath, import.meta.url).href);
      const value = await adapter.compileStyles({
        projectRoot,
        entries: message.input.entries,
      });
      // Plugins can embed absolute paths in CSS and nested diagnostic/map fields.
      const logicalValue = JSON.parse(
        JSON.stringify(value, (_key, item: unknown) =>
          typeof item === "string"
            ? workerRoots.reduce((text, root) => text.replaceAll(root, "/worker/"), item)
            : item,
        ),
      ) as unknown;
      send({ type: "result", value: logicalValue });
    } catch {
      send({ type: "error", code: "style-transform-failed" });
    }
    break;
  }
}
lines.close();
