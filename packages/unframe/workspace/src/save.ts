import type { SavedCommand } from "@unframe/contracts/author-http";

export type WorkspaceSave = {
  root: string;
  sourcePath: string;
  beforeSource: Uint8Array;
  afterSource: Uint8Array;
  beforeLock: Uint8Array;
  afterLock: Uint8Array;
  requestHash: string;
  saved: SavedCommand;
};
export const createWorkspaceSave = (input: WorkspaceSave): WorkspaceSave => ({
  ...input,
  beforeSource: input.beforeSource.slice(),
  afterSource: input.afterSource.slice(),
  beforeLock: input.beforeLock.slice(),
  afterLock: input.afterLock.slice(),
  saved: { ...input.saved },
});
