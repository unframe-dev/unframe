import { execFileSync } from "node:child_process";
import { runtimeMetadataSchema } from "./snapshot-schema.js";

export const probeNodeRuntime = (nodePath: string) =>
  runtimeMetadataSchema.parse(
    JSON.parse(
      execFileSync(
        nodePath,
        [
          "-e",
          "const h=process.report.getReport().header; process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime || 'non-glibc'}))",
        ],
        { env: {}, maxBuffer: 1024 * 1024 },
      ).toString(),
    ),
  );
