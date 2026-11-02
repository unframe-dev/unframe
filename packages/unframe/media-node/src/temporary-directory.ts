import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

/** Canonicalize only the runtime-owned temporary base, never project or source paths. */
export const temporaryDirectory = () => realpathSync(tmpdir());
