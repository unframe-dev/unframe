import { createInterface } from "node:readline";
import type { CompileStylesRequest, CompileStylesResult } from "@unframe/unframe-tailwind";

process.env.NODE_ENV = "production";
process.env.TZ = "UTC";
process.env.LANG = "C.UTF-8";
delete process.env.UNFRAME_BROWSER_EXECUTABLE;
process.chdir("/worker/project");

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
      } = await import(message.input.adapterPath);
      const value = await adapter.compileStyles({
        projectRoot: "/worker/project",
        entries: message.input.entries,
      });
      send({ type: "result", value });
    } catch {
      send({ type: "error", code: "style-transform-failed" });
    }
    break;
  }
}
lines.close();
