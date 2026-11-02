import { execFileSync } from "node:child_process";
import { runtimeMetadataSchema } from "@unframe/workspace";

export const probeNodeRuntime = (nodePath: string) =>
  runtimeMetadataSchema.parse(
    JSON.parse(
      execFileSync(
        nodePath,
        [
          "-e",
          "const h=process.report.getReport().header; process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,libc:process.platform === 'linux' ? (h.glibcVersionRuntime || 'non-glibc') : 'not-applicable'}))",
        ],
        { env: {}, maxBuffer: 1024 * 1024 },
      ).toString(),
    ),
  );
