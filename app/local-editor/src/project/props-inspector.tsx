import { useState } from "react";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { Button } from "../ui/button";
import { Modal } from "../ui/dialog";
import { PropsField } from "./props-field";
export function PropsInspector() {
  const workspace = useWorkspace();
  const s = useStore(workspace.project.store);
  const [next, setNext] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const selected = s.project?.instances.find((i) => i.instanceId === s.selectedId);
  const disabled =
    s.status === "saving" || s.status === "conflict" || !!s.pending || !s.project?.irHash;
  const choose = (id: string) => {
    if (!workspace.project.selectInstance(id || null)) {
      setNext(id || null);
      setConfirm(true);
    }
  };
  return (
    <section aria-label="公開 Props" className="inspector-section">
      <h2>公開 Props</h2>
      <select
        aria-label="Instance"
        value={s.selectedId ?? ""}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">Instance を選択</option>
        {s.project?.instances.map((i) => (
          <option key={i.instanceId} value={i.instanceId}>
            {i.instanceId}
          </option>
        ))}
      </select>
      {s.draft ? (
        Object.entries(s.draft.props).map(([id, prop]) => (
          <PropsField
            key={`${s.selectedId}/${id}`}
            id={id}
            prop={prop}
            disabled={disabled}
            changed={!Object.is(prop.value, selected?.props[id]?.value)}
            onChange={(value) => workspace.project.editProp(id, value)}
            onSave={() => void workspace.commands.saveProps(id)}
          />
        ))
      ) : (
        <p className="muted">
          {s.project?.instances.length
            ? "Instance を選んで公開 Props を調整できます。"
            : "Props 編集用の metadata がありません。Source をコードで編集してください。"}
        </p>
      )}
      {s.status === "conflict" && (
        <p role="alert">
          外部の変更と競合しています。入力値は保持しています。破棄して最新の Source
          を読み込んでください。
        </p>
      )}
      {s.error && <p role="alert">{s.error}</p>}
      <div className="flex gap-2">
        {s.pending && (
          <Button disabled={s.status === "saving"} onClick={() => void workspace.project.retry()}>
            同じ内容で再送
          </Button>
        )}
        {s.status !== "clean" && (
          <Button
            disabled={s.status === "saving" || !!s.pending}
            onClick={() => workspace.project.discard()}
          >
            変更を破棄
          </Button>
        )}
      </div>
      <Modal title="未保存の Props" open={confirm} onOpenChange={setConfirm}>
        <p>Instance を変更する前に、入力値の扱いを選んでください。</p>
        <div className="flex gap-2">
          <Button
            disabled={disabled}
            onClick={async () => {
              for (const [id, prop] of Object.entries(s.draft?.props ?? {})) {
                if (!Object.is(prop.value, selected?.props[id]?.value)) {
                  await workspace.commands.saveProps(id);
                  if (workspace.project.store.getState().pending) break;
                }
              }
              if (workspace.project.store.getState().status === "clean") {
                workspace.project.selectInstance(next);
                setConfirm(false);
              }
            }}
          >
            保存して変更
          </Button>
          <Button
            disabled={s.status === "saving" || !!s.pending}
            onClick={() => {
              workspace.project.discard();
              workspace.project.selectInstance(next);
              setConfirm(false);
            }}
          >
            破棄して変更
          </Button>
          <Button onClick={() => setConfirm(false)}>取消</Button>
        </div>
      </Modal>
    </section>
  );
}
