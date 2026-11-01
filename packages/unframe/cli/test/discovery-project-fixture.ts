import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const writeDiscoveryProjectFixture = async (directory: string) => {
  await Promise.all([
    writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "presentation.unframe.tsx", assets: {} };\n',
    ),
    writeFile(join(directory, "unframe.lock"), "{}\n"),
    writeFile(join(directory, "presentation.unframe.tsx"), "export default {};\n"),
  ]);
};
