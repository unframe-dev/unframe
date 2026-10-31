import { createStore } from "zustand/vanilla";
import type {
  AuthorInstance,
  EditCommand,
  PatchRequest,
  ProjectSnapshot,
} from "@unframe/core/cli/author-contract";
export type HistoryEntry = { forward: EditCommand; inverse: EditCommand; revision: string };
export type SaveAction =
  | { kind: "new"; forward: EditCommand; inverse: EditCommand }
  | { kind: "undo" | "redo"; entry: HistoryEntry };
export type PendingSave = { revision: string; request: PatchRequest; action: SaveAction };
export type EditStatus = "clean" | "dirty" | "saving" | "conflict" | "failed";
export type ProjectState = {
  project: ProjectSnapshot | null;
  selectedId: string | null;
  draft: AuthorInstance | null;
  baseRevision: string | null;
  status: EditStatus;
  pending: PendingSave | null;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  error: string | null;
};
export const createProjectStore = () =>
  createStore<ProjectState>(() => ({
    project: null,
    selectedId: null,
    draft: null,
    baseRevision: null,
    status: "clean",
    pending: null,
    undo: [],
    redo: [],
    error: null,
  }));
