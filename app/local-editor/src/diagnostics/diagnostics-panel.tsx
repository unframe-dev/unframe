import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
export function DiagnosticsPanel() {
  const w = useWorkspace();
  const project = useStore(w.project.store, (s) => s.project);
  const preview = useStore(w.preview.store);
  const publication = useStore(w.publication.store);
  const errors = [preview.error, publication.error].filter(Boolean);
  const items = [
    ...(project?.diagnostics ?? []),
    ...(preview.job?.diagnostics ?? []),
    ...(publication.job?.diagnostics ?? []),
  ];
  return (
    <section className="diagnostics" aria-label="問題">
      <h2>問題</h2>
      {!items.length && !errors.length && <p className="muted">問題は報告されていません。</p>}
      {errors.map((error, i) => (
        <p role="alert" key={i}>
          {error}
        </p>
      ))}
      {items.map((item, i) => (
        <article key={i}>
          <strong>{item.code}</strong>
          <p>{item.message}</p>
          {item.location && (
            <small>
              {item.location.fileName}:{item.location.line}:{item.location.column}
            </small>
          )}
        </article>
      ))}
    </section>
  );
}
