import type {
  EditCommand,
  ProjectSnapshot,
  PatchRequest,
  SavedCommand,
  ProjectChange,
} from "@unframe-dev/contracts/author-http";
import { createProjectStore, type SaveAction, type PendingSave } from "./project-store";
import { changedPropIds, inverseProp, validProp } from "./edit-state";
type ProjectPort = {
  projectChanges(cursor?: string, signal?: AbortSignal): Promise<ProjectChange>;
  project(signal?: AbortSignal): Promise<ProjectSnapshot>;
  patch(revision: string, body: PatchRequest, signal?: AbortSignal): Promise<SavedCommand>;
};
export function createProjectController({
  api,
  newId = () => crypto.randomUUID().replaceAll("-", ""),
  onSaved = () => {},
  onProject = () => {},
}: {
  api: ProjectPort;
  newId?: () => string;
  onSaved?: (revision: string) => void;
  onProject?: (project: ProjectSnapshot) => void;
}) {
  const store = createProjectStore();
  const abort = new AbortController();
  let disposed = false;
  let epoch = 0;
  let readSerial = 0;
  let started = false;
  let retry: (() => void) | undefined;
  const state = store.getState;
  function accept(next: ProjectSnapshot, own = false) {
    if (disposed) return;
    const old = state();
    if (old.project?.revision === next.revision) {
      const instance = next.instances.find((i) => i.instanceId === old.selectedId);
      store.setState({
        project: next,
        dirtyPropIds: old.status === "clean" ? new Set() : changedPropIds(old.draft, instance),
        ...(old.status === "clean" ? { draft: instance ? structuredClone(instance) : null } : {}),
      });
      onProject(next);
      return;
    }
    const protect = old.status !== "clean";
    const selected = next.instances.find((i) => i.instanceId === old.selectedId);
    store.setState({
      project: next,
      dirtyPropIds: protect ? changedPropIds(old.draft, selected) : new Set(),
      ...(!own ? { undo: [], redo: [] } : {}),
      ...(protect
        ? { status: old.status === "saving" ? "saving" : "conflict" }
        : {
            draft: selected ? structuredClone(selected) : null,
            selectedId: selected?.instanceId ?? null,
            baseRevision: next.revision,
          }),
    });
    onProject(next);
  }
  async function refresh() {
    if (disposed) return false;
    const version = epoch,
      serial = ++readSerial;
    try {
      const next = await api.project(abort.signal);
      if (version === epoch && serial === readSerial) {
        accept(next);
        if (state().status === "clean") store.setState({ error: null });
        return true;
      }
    } catch (error) {
      if (!disposed && version === epoch && serial === readSerial)
        store.setState({ error: String(error) });
    }
    return false;
  }
  function start() {
    if (disposed || started) return;
    started = true;
    void (async () => {
      let cursor: string | undefined;
      let delay = 1000;
      let observationError: string | undefined;
      while (!disposed) {
        try {
          const change = await api.projectChanges(cursor, abort.signal);
          if (disposed) return;
          if (change.changed && !(await refresh()))
            throw new Error(state().error ?? "Project refresh failed.");
          cursor = change.cursor;
          delay = 1000;
          if (observationError && state().error === observationError)
            store.setState({ error: null });
          observationError = undefined;
        } catch (error) {
          if (disposed) return;
          if (state().status === "clean" || state().error === null) {
            observationError = String(error);
            store.setState({ error: observationError });
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay);
            retry = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          retry = undefined;
          delay = Math.min(10_000, delay * 2);
        }
      }
    })();
  }
  function selectInstance(id: string | null) {
    const s = state();
    if (disposed || s.pending || s.status !== "clean") return false;
    const instance = s.project?.instances.find((i) => i.instanceId === id);
    store.setState({
      selectedId: instance?.instanceId ?? null,
      draft: instance ? structuredClone(instance) : null,
      dirtyPropIds: new Set(),
      baseRevision: s.project?.revision ?? null,
      error: null,
    });
    return true;
  }
  function editProp(propId: string, value: string | number | boolean) {
    const s = state();
    if (
      disposed ||
      !s.draft ||
      s.pending ||
      s.status === "conflict" ||
      !validProp(s.draft, propId, value)
    )
      return;
    if (Object.is(s.draft.props[propId]!.value, value)) {
      if (s.error !== null) store.setState({ error: null });
      return;
    }
    const draft = {
      ...s.draft,
      props: { ...s.draft.props, [propId]: { ...s.draft.props[propId]!, value } },
    };
    const original = s.project?.instances.find((i) => i.instanceId === s.selectedId);
    let dirtyPropIds = s.dirtyPropIds;
    const changed = !Object.is(value, original?.props[propId]?.value);
    if (changed !== dirtyPropIds.has(propId)) {
      const updated = new Set(dirtyPropIds);
      if (changed) updated.add(propId);
      else updated.delete(propId);
      dirtyPropIds = updated;
    }
    store.setState({
      draft,
      dirtyPropIds,
      status: dirtyPropIds.size ? "dirty" : "clean",
      error: null,
    });
  }
  function discard() {
    const s = state();
    if (disposed || s.status === "saving" || s.pending) return;
    const instance = s.project?.instances.find((i) => i.instanceId === s.selectedId);
    store.setState({
      draft: instance ? structuredClone(instance) : null,
      dirtyPropIds: new Set(),
      baseRevision: s.project?.revision ?? null,
      status: "clean",
      error: null,
    });
  }
  async function attempt(pending: PendingSave) {
    if (disposed || state().status === "saving") return;
    ++epoch;
    store.setState({ status: "saving", pending, error: null });
    try {
      const saved = await api.patch(pending.revision, pending.request, abort.signal);
      if (disposed) return;
      if (saved.commandId !== pending.request.commandId)
        throw new Error("保存応答の command ID が一致しません");
      ++epoch;
      const s = state();
      const action = pending.action;
      let undo = s.undo.slice();
      let redo = s.redo.slice();
      const rebase = (entries: typeof undo) =>
        entries.map((e, i) => (i === entries.length - 1 ? { ...e, revision: saved.revision } : e));
      if (action.kind === "new") {
        undo.push({ forward: action.forward, inverse: action.inverse, revision: saved.revision });
        redo = [];
      } else if (action.kind === "undo") {
        undo = rebase(undo.slice(0, -1));
        redo.push({ ...action.entry, revision: saved.revision });
      } else {
        redo = rebase(redo.slice(0, -1));
        undo.push({ ...action.entry, revision: saved.revision });
      }
      const draft = s.draft ? structuredClone(s.draft) : null;
      const command = pending.request.command;
      const remaining = new Set(
        [...s.dirtyPropIds].filter((id) => !(command.kind === "setProp" && command.propId === id)),
      );
      if (
        draft &&
        command.kind === "setProp" &&
        draft.instanceId === command.instanceId &&
        draft.props[command.propId]
      )
        draft.props[command.propId]!.value = command.value;
      const project = s.project ? structuredClone(s.project) : null;
      if (project) {
        project.revision = saved.revision;
        project.sourceHash = saved.sourceHash;
        project.irHash = saved.irHash;
        const instance = project.instances.find((i) => i.instanceId === command.instanceId);
        if (instance && command.kind === "setProp" && instance.props[command.propId]) {
          instance.props[command.propId]!.value = command.value;
          instance.props[command.propId]!.inherited = false;
          delete instance.props[command.propId]!.inheritanceExpression;
        }
      }
      if (draft && command.kind === "setProp" && draft.props[command.propId]) {
        draft.props[command.propId]!.inherited = false;
        delete draft.props[command.propId]!.inheritanceExpression;
      }
      store.setState({
        project,
        draft,
        baseRevision: saved.revision,
        dirtyPropIds: remaining,
        status: remaining.size ? "dirty" : "clean",
        pending: null,
        undo,
        redo,
        error: null,
      });
      onSaved(saved.revision);
      const version = epoch,
        serial = ++readSerial;
      try {
        const latest = await api.project(abort.signal);
        if (!disposed && version === epoch && serial === readSerial) {
          if (latest.revision === saved.revision) {
            const current = state();
            const instance = latest.instances.find((i) => i.instanceId === current.selectedId);
            const refreshed = instance ? structuredClone(instance) : null;
            if (refreshed)
              for (const id of current.dirtyPropIds) {
                const prop = current.draft?.props[id];
                if (prop) refreshed.props[id] = structuredClone(prop);
              }
            const dirtyPropIds = changedPropIds(refreshed, instance);
            store.setState({
              project: latest,
              draft: refreshed,
              dirtyPropIds,
              status: dirtyPropIds.size ? "dirty" : "clean",
            });
            onProject(latest);
          } else accept(latest);
        }
      } catch (error) {
        if (!disposed && version === epoch && serial === readSerial)
          store.setState({ error: `保存済み・再読込失敗: ${String(error)}` });
      }
    } catch (error) {
      if (disposed) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : null;
      if (typeof status === "number" && status >= 400 && status < 500) {
        store.setState({
          pending: null,
          status: status === 409 || status === 412 ? "conflict" : "dirty",
          undo: [],
          redo: [],
          error: String(error),
        });
        await refresh();
      } else
        store.setState({
          status: "failed",
          error: `保存結果未確認: ${String(error)}。同じ要求を再送できます。`,
        });
    }
  }
  async function save(command: EditCommand, action: SaveAction) {
    const s = state();
    if (
      disposed ||
      s.pending ||
      !s.project?.irHash ||
      s.status === "conflict" ||
      s.status === "saving" ||
      s.baseRevision !== s.project.revision
    )
      return;
    await attempt({
      revision: s.project.revision,
      request: { commandId: newId(), expectedIrHash: s.project.irHash, command },
      action,
    });
  }
  async function saveProp(propId: string) {
    const s = state();
    const original = s.project?.instances.find((i) => i.instanceId === s.selectedId);
    const value = s.draft?.props[propId]?.value;
    if (!original || value === undefined || !validProp(original, propId, value)) return;
    const inverse = inverseProp(original, propId);
    if (!inverse) return;
    const command: EditCommand = {
      kind: "setProp",
      instanceId: original.instanceId,
      propId,
      value,
    };
    await save(command, { kind: "new", forward: command, inverse });
  }
  async function history(kind: "undo" | "redo") {
    const s = state();
    if (s.status !== "clean") return;
    const entry = (kind === "undo" ? s.undo : s.redo).at(-1);
    if (!entry || entry.revision !== s.project?.revision) return;
    await save(kind === "undo" ? entry.inverse : entry.forward, { kind, entry });
  }
  function rebaseRevision(revision: string) {
    const s = state();
    if (disposed || !s.project || s.project.revision === revision) return;
    ++epoch;
    store.setState({
      project: { ...s.project, revision },
      baseRevision: s.status === "clean" || s.status === "dirty" ? revision : s.baseRevision,
      undo: s.undo.map((e, i) => (i === s.undo.length - 1 ? { ...e, revision } : e)),
      redo: s.redo.map((e, i) => (i === s.redo.length - 1 ? { ...e, revision } : e)),
    });
    void refresh();
  }
  return {
    store,
    start,
    refresh,
    selectInstance,
    editProp,
    discard,
    saveProp,
    retry: async () => {
      const p = state().pending;
      if (p) await attempt(p);
    },
    undo: () => history("undo"),
    redo: () => history("redo"),
    rebaseRevision,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++epoch;
      abort.abort();
      retry?.();
    },
  };
}
