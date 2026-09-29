import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthorInstance,
  BuildJob,
  ProjectSnapshot,
  Transform,
} from "../../../../../packages/unframe-cli/src/author/contract";
import { AuthorApiError, type AuthorApi } from "./api";
import "./author.css";

type Preview = { url: string; revision: string };
type PendingSave = { revision: string; request: Parameters<AuthorApi["patch"]>[1] };
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const terminal = (status: BuildJob["status"]) =>
  ["succeeded", "failed", "cancelled", "stale"].includes(status);

export function AuthorApp({ api }: { api: AuthorApi }) {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthorInstance | null>(null);
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [job, setJob] = useState<BuildJob | null>(null);
  const [buildStarting, setBuildStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const previewRef = useRef(preview);
  const generation = useRef(0);
  const buildRequestInFlight = useRef(false);
  const mounted = useRef(true);
  const note = useCallback(
    (message: string) => setMessages((old) => [message, ...old].slice(0, 8)),
    [],
  );

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    mounted.current = true;
    void api
      .project()
      .then(setProject)
      .catch((error: unknown) => note(`読込失敗: ${errorText(error)}`));
    return () => {
      mounted.current = false;
      generation.current++;
      Object.values(previewRef.current).forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [api, note]);

  const selected = project?.instances.find((item) => item.instanceId === selectedId) ?? null;
  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
  }, [selected]);

  async function runBuild(revision: string) {
    if (buildRequestInFlight.current) return;
    buildRequestInFlight.current = true;
    setBuildStarting(true);
    const serial = ++generation.current;
    let generated: Preview[] = [];
    try {
      const started = await api.build(revision, newId()).finally(() => {
        buildRequestInFlight.current = false;
        if (mounted.current) setBuildStarting(false);
      });
      if (!mounted.current || serial !== generation.current) return;
      setJob(started);
      let current = started;
      while (!terminal(current.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!mounted.current || serial !== generation.current) return;
        current = await api.job(started.buildId);
        if (!mounted.current || serial !== generation.current) return;
        setJob(current);
      }
      if (current.status !== "succeeded" || current.revision !== revision) {
        note(
          `build ${current.status}: ${current.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ") || "preview は維持されました"}`,
        );
        return;
      }
      const next: Record<string, Preview> = {};
      for (const artifact of current.artifacts.filter((item) => item.mediaType === "image/png")) {
        const blob = await api.artifact(current.buildId, artifact.assetId);
        if (!mounted.current || serial !== generation.current) {
          Object.values(next).forEach(({ url }) => URL.revokeObjectURL(url));
          return;
        }
        const previous = next[artifact.instanceId];
        if (previous) URL.revokeObjectURL(previous.url);
        const created = { url: URL.createObjectURL(blob), revision };
        next[artifact.instanceId] = created;
        generated.push(created);
      }
      if (!mounted.current || serial !== generation.current) {
        generated.forEach(({ url }) => URL.revokeObjectURL(url));
        return;
      }
      setPreview((old) => {
        const updated = { ...old, ...next };
        for (const id of Object.keys(next)) if (old[id]) URL.revokeObjectURL(old[id].url);
        return updated;
      });
      generated = [];
      note(`preview 更新: ${revision}`);
    } catch (error) {
      generated.forEach(({ url }) => URL.revokeObjectURL(url));
      note(`build/capture 失敗: ${errorText(error)}`);
    }
  }

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
  async function save(command: Parameters<AuthorApi["patch"]>[1]["command"]) {
    if (!project?.irHash || busy || pendingSave) return;
    const pending: PendingSave = {
      revision: project.revision,
      request: structuredClone({ commandId: newId(), expectedIrHash: project.irHash, command }),
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
      note(`保存完了: ${saved.revision}`);
      try {
        const latest = await api.project();
        setProject(latest);
        if (latest.revision === saved.revision) void runBuild(saved.revision);
        else note(`保存後に別の変更を検出: ${latest.revision}`);
      } catch (error) {
        note(`保存済み・再読込失敗: ${errorText(error)}`);
      }
    } catch (error) {
      if (error instanceof AuthorApiError && error.status >= 400 && error.status < 500) {
        setPendingSave(null);
        note(
          `${[409, 412].includes(error.status) ? "保存競合" : "保存拒否"}: ${error.code}: ${errorText(error)}`,
        );
        try {
          setProject(await api.project());
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
    generation.current++;
    setBusy(true);
    try {
      setProject(await api.project());
    } catch (error) {
      note(`再読込失敗: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!job || terminal(job.status)) return;
    try {
      await api.cancel(job.buildId);
      note("build を中止しました");
    } catch (error) {
      note(`中止失敗: ${errorText(error)}`);
    }
  }
  const shown = selectedId ? preview[selectedId] : undefined;
  const stale = shown && project && shown.revision !== project.revision;
  return (
    <main className="author-shell">
      <header>
        <h1>Unframe Author</h1>
        <button disabled={busy} onClick={() => void reload()}>
          再読込
        </button>
        <button
          disabled={
            busy ||
            buildStarting ||
            !!pendingSave ||
            !project?.irHash ||
            (job !== null && !terminal(job.status))
          }
          onClick={() => project && void runBuild(project.revision)}
        >
          Preview を生成
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
      <section className="author-inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        {draft ? (
          <>
            <p>{draft.instanceId}</p>
            <h3>公開 props</h3>
            {Object.entries(draft.props).map(([id, prop]) => (
              <div className="author-field" key={id}>
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
          <p>Instance を選択してください</p>
        )}
      </section>
      <section className="author-preview" aria-label="Preview">
        <h2>Preview</h2>
        <p>
          表示 revision: {shown?.revision ?? "なし"} {stale ? "（stale）" : ""}
        </p>
        {shown && <img src={shown.url} alt={`${selectedId} preview`} />}
        {job && (
          <p>
            build: {job.status}{" "}
            <button onClick={() => void cancel()} disabled={terminal(job.status)}>
              中止
            </button>
          </p>
        )}
      </section>
      <aside aria-label="Diagnostics">
        <h2>Diagnostics</h2>
        {project?.diagnostics.map((item, index) => (
          <p key={`${item.code}-${index}`}>
            {item.code}: {item.message}
          </p>
        ))}
        {job?.diagnostics.map((item, index) => (
          <p key={`build-${item.code}-${index}`}>
            {item.code}: {item.message}
          </p>
        ))}
        {messages.map((message, index) => (
          <p key={`${index}-${message}`}>{message}</p>
        ))}
      </aside>
    </main>
  );
}
