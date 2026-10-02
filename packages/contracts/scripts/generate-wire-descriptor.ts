import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import protobuf from "protobufjs";
import { formatGenerated } from "./format-generated";

const root = resolve(import.meta.dirname, "..");
const protoRoot = resolve(root, "proto");
const output = resolve(root, "presentation/v2/wire-descriptor.json");
const files = [
  "unframe/presentation/v2/runtime.proto",
  "unframe/delivery/v2/delivery.proto",
  "unframe/realtime/v2/realtime.proto",
];
const descriptor = new protobuf.Root();
descriptor.resolvePath = (_origin, target) => resolve(protoRoot, target);
descriptor.loadSync(files);
descriptor.resolveAll();
const bytes = formatGenerated(output, `${JSON.stringify(descriptor.toJSON(), null, 2)}\n`);

if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== bytes) {
    process.stderr.write("Presentation v2 wire descriptor is stale\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(output, bytes);
}
