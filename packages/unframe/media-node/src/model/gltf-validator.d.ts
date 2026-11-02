export function validateBytes(
  bytes: Uint8Array,
  options: {
    format: "glb";
    writeTimestamp: boolean;
    maxIssues: number;
  },
): Promise<unknown>;
