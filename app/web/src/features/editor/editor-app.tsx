import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthorInstance,
  AuthorDiagnostic,
  BuildJob,
  EditCommand,
  ProjectSnapshot,
  Transform,
} from "@unframe/unframe-cli/author-contract";
import { EditorApiError, type EditorApi } from "./api";
import "./editor.css";
import {
  createPreviewSession,
  type LoadedPreview,
  type PreviewDriver,
  type PreviewMode,
} from "./model/preview-session";
import { PublicationPanel, type DisplayReceipt } from "./publication-panel";

type HistoryEntry = { forward: EditCommand; inverse: EditCommand; revision: string };
type HistoryAction =
  | { kind: "new"; forward: EditCommand; inverse: EditCommand }
  | { kind: "undo" | "redo"; entry: HistoryEntry };
type PendingSave = {
  revision: string;
  request: Parameters<EditorApi["patch"]>[1];
  action: HistoryAction;
};
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const diagnosticText = (item: AuthorDiagnostic) =>
  `${item.location ? `${item.location.fileName}:${item.location.line}:${item.location.column} ` : ""}${item.family ? `${item.family}/` : ""}${item.code}${item.path?.length ? ` ($/${item.path.map(String).join("/")})` : ""}: ${item.message}`;
const terminal = (status: BuildJob["status"]) =>
  ["succeeded", "failed", "cancelled", "stale"].includes(status);
export function EditorApp({
  api,
  createDriver,
}: {
  api: EditorApi;
  createDriver: (canvas: HTMLCanvasElement) => PreviewDriver & { close(): Promise<void> };
}) {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthorInstance | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [distBuilding, setDistBuilding] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<ReturnType<typeof createPreviewSession> | null>(null);
  const [mode, setMode] = useState<PreviewMode>("dev");
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
  const [receipt, setReceipt] = useState<DisplayReceipt | null>(null);
  const [buildingRevision, setBuildingRevision] = useState<string | null>(null);
  const ownRefresh = useRef<string | null>(null);
  const modeRef = useRef(mode);
  const latestRevision = useRef<string | null>(null);
  const draftOwner = useRef("");
  const mounted = useRef(true);
  const note = useCallback(
    (message: string) => setMessages((old) => [message, ...old].slice(0, 8)),
    [],
  );

  const acceptProject = useCallback((next: ProjectSnapshot) => {
    latestRevision.current = next.revision;
    setProject(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || !mounted.current) return;
      reading = true;
      const startingRevision = latestRevision.current;
      try {
        const next = await api.project();
        if (latestRevision.current !== startingRevision && next.revision !== latestRevision.current)
          return;
        if (mounted.current && next.revision !== latestRevision.current) {
          if (latestRevision.current && next.revision !== ownRefresh.current) {
            setUndoStack([]);
            setRedoStack([]);
          }
          acceptProject(next);
        }
      } catch (error) {
        if (mounted.current) note(`読込失敗: ${errorText(error)}`);
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [api, note, acceptProject]);
  useEffect(() => {
    if (!canvas.current) return;
    const driver = createDriver(canvas.current);
    const controller = createPreviewSession({
      api,
      driver,
      onRevision: (revision) => {
        ownRefresh.current = revision;
        if (latestRevision.current === revision) {
          setBuildingRevision(revision);
          return;
        }
        latestRevision.current = revision;
        setBuildingRevision(revision);
        setProject((old) => (old ? { ...old, revision } : old));
        setUndoStack((old) =>
          old.map((entry, index) => (index === old.length - 1 ? { ...entry, revision } : entry)),
        );
        setRedoStack((old) =>
          old.map((entry, index) => (index === old.length - 1 ? { ...entry, revision } : entry)),
        );
        void api
          .project()
          .then((next) => {
            if (
              mounted.current &&
              latestRevision.current === revision &&
              next.revision === revision
            )
              acceptProject(next);
          })
          .catch((error: unknown) => note(`再読込失敗: ${errorText(error)}`));
      },
      onJob: setJob,
      onLoaded: (next) => {
        setLoaded(next);
        setReceipt(
          next.mode === "dist"
            ? { requestId: next.requestId, buildIdentity: next.buildIdentity }
            : null,
        );
      },
      onInvalidated: () => {
        if (mounted.current) setReceipt(null);
      },
      onError: (error) => note(`Preview 失敗: ${errorText(error)}`),
    });
    session.current = controller;
    return () => {
      session.current = null;
      controller.close();
      void driver.close().catch(() => undefined);
    };
  }, [api, createDriver, note, acceptProject]);
  useEffect(() => {
    const changedMode = modeRef.current !== mode;
    if (!project || distBuilding) return;
    modeRef.current = mode;
    if (mode === "dist") {
      if (changedMode) session.current?.request("dist", project.revision);
    } else if (changedMode || project.revision !== ownRefresh.current) {
      setBuildingRevision(project.revision);
      session.current?.request("dev", project.revision);
    }
  }, [mode, project?.revision, distBuilding]);

  const selected = project?.instances.find((item) => item.instanceId === selectedId) ?? null;
  useEffect(() => {
    const key = JSON.stringify(selected);
    if (draftOwner.current !== key) {
      draftOwner.current = key;
      setDraft(selected ? structuredClone(selected) : null);
    }
  }, [selected]);

  async function saveProp(propId: string) {
    if (!project || !selected || !draft) return;
    const prop = draft.props[propId];
    if (!prop?.editable) return;
    if (prop.type === "number" && !Number.isFinite(prop.value)) {
      note("数値には有限数を入力してください");
      return;
    }
    await save({ kind: "setProp", instanceId: selected.instanceId, propId, value: prop.value });
  }
  async function saveTransform() {
    if (!project || !selected || !draft?.transformEditable) return;
    const values = [
      ...draft.transform.position,
      ...draft.transform.rotation,
      ...draft.transform.scale,
    ];
    if (!values.every(Number.isFinite)) {
      note("Transform は有限数を入力してください");
      return;
    }
    await save({
      kind: "setTransform",
      instanceId: selected.instanceId,
      transform: draft.transform,
    });
  }
  async function save(command: Parameters<EditorApi["patch"]>[1]["command"]) {
    if (!project?.irHash || busy || pendingSave) return;
    if (!selected) return;
    let inverse: EditCommand;
    if (command.kind === "setProp") {
      const previous = selected.props[command.propId];
      if (!previous) return;
      inverse = previous.inherited
        ? previous.inheritanceExpression
          ? {
              kind: "restoreProp",
              instanceId: command.instanceId,
              propId: command.propId,
              expression: previous.inheritanceExpression,
            }
          : { kind: "inheritProp", instanceId: command.instanceId, propId: command.propId }
        : {
            kind: "setProp",
            instanceId: command.instanceId,
            propId: command.propId,
            value: previous.value,
          };
    } else if (command.kind === "setTransform") {
      inverse = selected.transformInherited
        ? selected.transformInheritanceExpression
          ? {
              kind: "restoreTransform",
              instanceId: command.instanceId,
              expression: selected.transformInheritanceExpression,
            }
          : { kind: "inheritTransform", instanceId: command.instanceId }
        : {
            kind: "setTransform",
            instanceId: command.instanceId,
            transform: structuredClone(selected.transform),
          };
    } else return;
    await saveWithAction(command, { kind: "new", forward: command, inverse });
  }
  async function saveWithAction(command: EditCommand, action: HistoryAction) {
    if (!project?.irHash || busy || pendingSave) return;
    const pending: PendingSave = {
      revision: project.revision,
      request: structuredClone({ commandId: newId(), expectedIrHash: project.irHash, command }),
      action,
    };
    setPendingSave(pending);
    await attemptSave(pending);
  }
  async function attemptSave(pending: PendingSave) {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api.patch(pending.revision, pending.request);
      setPendingSave(null);
      const action = pending.action;
      if (action.kind === "new") {
        setUndoStack((old) => [
          ...old,
          { forward: action.forward, inverse: action.inverse, revision: saved.revision },
        ]);
        setRedoStack([]);
      } else if (action.kind === "undo") {
        setUndoStack((old) =>
          old
            .slice(0, -1)
            .map((entry, index, remaining) =>
              index === remaining.length - 1 ? { ...entry, revision: saved.revision } : entry,
            ),
        );
        setRedoStack((old) => [...old, { ...action.entry, revision: saved.revision }]);
      } else {
        setRedoStack((old) =>
          old
            .slice(0, -1)
            .map((entry, index, remaining) =>
              index === remaining.length - 1 ? { ...entry, revision: saved.revision } : entry,
            ),
        );
        setUndoStack((old) => [...old, { ...action.entry, revision: saved.revision }]);
      }
      note(`保存完了: ${saved.revision}`);
      try {
        const latest = await api.project();
        acceptProject(latest);
        if (latest.revision !== saved.revision) {
          setUndoStack([]);
          setRedoStack([]);
          note(`保存後に別の変更を検出: ${latest.revision}`);
        }
      } catch (error) {
        note(`保存済み・再読込失敗: ${errorText(error)}`);
      }
    } catch (error) {
      if (error instanceof EditorApiError && error.status >= 400 && error.status < 500) {
        setPendingSave(null);
        if ([409, 412].includes(error.status)) {
          setUndoStack([]);
          setRedoStack([]);
        }
        note(
          `${[409, 412].includes(error.status) ? "保存競合" : "保存拒否"}: ${error.code}: ${errorText(error)}`,
        );
        try {
          acceptProject(await api.project());
        } catch (reloadError) {
          note(`再読込失敗: ${errorText(reloadError)}`);
        }
      } else {
        note(`保存結果未確認: ${errorText(error)}。同じ内容で再送してください`);
      }
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await api.project();
      acceptProject(latest);
      if (latest.revision !== project?.revision) {
        setUndoStack([]);
        setRedoStack([]);
      }
    } catch (error) {
      note(`再読込失敗: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function buildDist() {
    if (!project) return;
    setBusy(true);
    setDistBuilding(true);
    setBuildingRevision(project.revision);
    try {
      await session.current?.cancel();
      let current = await api.distBuild(project.revision, newId());
      setJob(current);
      while (!terminal(current.status) && mounted.current) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        current = await api.job(current.buildId);
        if (mounted.current) setJob(current);
      }
      if (current.status !== "succeeded") throw new Error(`Dist build ${current.status}`);
      note("Dist build 完了。Dist Preview を読み込んで確認してください。");
    } catch (error) {
      note(`Dist build 失敗: ${errorText(error)}`);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setDistBuilding(false);
      }
    }
  }
  const undo = undoStack.at(-1);
  const redo = redoStack.at(-1);
  return (
    <main className="editor-shell">
      <header>
        <h1>Unframe Editor</h1>
        <button disabled={busy} onClick={() => void reload()}>
          再読込
        </button>
        <button
          disabled={busy || !!pendingSave || !undo || undo.revision !== project?.revision}
          onClick={() => undo && void saveWithAction(undo.inverse, { kind: "undo", entry: undo })}
        >
          Undo
        </button>
        <button
          disabled={busy || !!pendingSave || !redo || redo.revision !== project?.revision}
          onClick={() => redo && void saveWithAction(redo.forward, { kind: "redo", entry: redo })}
        >
          Redo
        </button>
        <button
          disabled={busy || !!pendingSave || !project || (job !== null && !terminal(job.status))}
          onClick={() => void buildDist()}
        >
          本番 build
        </button>
        <span>保存 revision: {project?.revision ?? "読込中"}</span>
        {pendingSave && (
          <button disabled={busy} onClick={() => void attemptSave(pendingSave)}>
            同じ内容で再送
          </button>
        )}
      </header>
      <nav aria-label="Instance 一覧">
        <h2>Instances</h2>
        {project?.instances.map((instance) => (
          <button
            key={instance.instanceId}
            type="button"
            aria-current={instance.instanceId === selectedId ? "true" : undefined}
            onClick={() => setSelectedId(instance.instanceId)}
          >
            {instance.instanceId}
          </button>
        ))}
      </nav>
      <section className="editor-inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        {draft ? (
          <>
            <p>{draft.instanceId}</p>
            <h3>公開 props</h3>
            {Object.entries(draft.props).map(([id, prop]) => (
              <div className="editor-field" key={id}>
                <label htmlFor={`prop-${id}`}>{id}</label>
                {prop.type === "boolean" ? (
                  <input
                    id={`prop-${id}`}
                    type="checkbox"
                    checked={Boolean(prop.value)}
                    disabled={!prop.editable || busy || !!pendingSave}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        props: { ...draft.props, [id]: { ...prop, value: event.target.checked } },
                      })
                    }
                  />
                ) : prop.editor?.kind === "text" ? (
                  <textarea
                    id={`prop-${id}`}
                    value={String(prop.value)}
                    disabled={!prop.editable || busy || !!pendingSave}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        props: { ...draft.props, [id]: { ...prop, value: event.target.value } },
                      })
                    }
                  />
                ) : (
                  <input
                    id={`prop-${id}`}
                    type={prop.type === "number" ? "number" : "text"}
                    value={String(prop.value)}
                    disabled={!prop.editable || busy || !!pendingSave}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        props: {
                          ...draft.props,
                          [id]: {
                            ...prop,
                            value:
                              prop.type === "number"
                                ? event.target.valueAsNumber
                                : event.target.value,
                          },
                        },
                      })
                    }
                  />
                )}
                <button
                  disabled={
                    !prop.editable ||
                    busy ||
                    !!pendingSave ||
                    !project?.irHash ||
                    Object.is(prop.value, selected?.props[id]?.value)
                  }
                  onClick={() => void saveProp(id)}
                >
                  保存
                </button>
                {!prop.editable && <small>readonly</small>}
              </div>
            ))}
            <h3>3D Transform</h3>
            {(["position", "rotation", "scale"] as const).map((key) => (
              <fieldset key={key} disabled={!draft.transformEditable || busy || !!pendingSave}>
                <legend>{key}</legend>
                {draft.transform[key].map((value, index) => (
                  <label key={index}>
                    {["x", "y", "z", "w"][index]}
                    <input
                      type="number"
                      step="any"
                      value={Number.isNaN(value) ? "" : value}
                      onChange={(event) => {
                        const vector = [...draft.transform[key]];
                        vector[index] = event.target.valueAsNumber;
                        setDraft({
                          ...draft,
                          transform: { ...draft.transform, [key]: vector } as Transform,
                        });
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            ))}
            <button
              disabled={
                !draft.transformEditable ||
                busy ||
                !!pendingSave ||
                !project?.irHash ||
                JSON.stringify(draft.transform) === JSON.stringify(selected?.transform)
              }
              onClick={() => void saveTransform()}
            >
              Transform を保存
            </button>
            {!draft.transformEditable && <small> readonly</small>}
          </>
        ) : (
          <p>
            {project?.instances.length
              ? "Instance を選択してください"
              : "Inspector 編集に対応しない Source です。外部 editor で保存してください。"}
          </p>
        )}
      </section>
      <section className="editor-preview" aria-label="Preview">
        <h2>Preview</h2>
        <div role="group" aria-label="Preview mode">
          <button aria-pressed={mode === "dev"} onClick={() => setMode("dev")}>
            Dev Preview
          </button>
          <button aria-pressed={mode === "dist"} onClick={() => setMode("dist")}>
            Dist Preview
          </button>
          <button
            disabled={!project}
            onClick={() => project && session.current?.request(mode, project.revision)}
          >
            Preview を再読込
          </button>
          <button disabled={!job || terminal(job.status)} onClick={() => session.current?.cancel()}>
            build 中止
          </button>
        </div>
        <p>build 入力 revision: {buildingRevision ?? "なし"}</p>
        <p>表示 build identity: {loaded?.buildIdentity ?? "なし"}</p>
        <p>
          表示 mode: {loaded?.mode ?? "なし"} / 表示 revision:{" "}
          {loaded?.sourceRevision ?? "Dist / なし"}
        </p>
        {loaded?.mode === "dev" && loaded.sourceRevision !== project?.revision && (
          <p>保存済み内容と現在の表示が異なります</p>
        )}
        <canvas id="unity-preview-canvas" ref={canvas} aria-label="Unity Preview" tabIndex={0} />
        {job && <p>build: {job.status}</p>}
      </section>
      <PublicationPanel api={api} receipt={mode === "dist" ? receipt : null} />
      <aside aria-label="Diagnostics">
        <h2>Diagnostics</h2>
        {project?.diagnostics.map((item, index) => (
          <p key={`${item.code}-${index}`}>{diagnosticText(item)}</p>
        ))}
        {job?.diagnostics.map((item, index) => (
          <p key={`build-${item.code}-${index}`}>{diagnosticText(item)}</p>
        ))}
        {messages.map((message, index) => (
          <p key={`${index}-${message}`}>{message}</p>
        ))}
      </aside>
    </main>
  );
}
