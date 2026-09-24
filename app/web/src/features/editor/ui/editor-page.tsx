import { useEffect, useState } from "react";
import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import { EditorDocumentProvider } from "@/features/editor/model/editor-document-context";
import { createEditorSessionStore, type EditorPanel } from "@/features/editor/model/editor-session";
import { EditorSessionProvider } from "@/features/editor/model/editor-session-context";
import { browserDocumentPublisher } from "@/features/editor/infra/document-runtime";
import { EditorShell } from "./editor-shell";

export function EditorPage({
  document,
  panel,
}: {
  document: PresentationDocument;
  panel: EditorPanel;
}) {
  const [sessionStore] = useState(() => createEditorSessionStore(document.slides[0]?.id ?? ""));

  useEffect(() => sessionStore.getState().setPanel(panel), [panel, sessionStore]);

  return (
    <EditorSessionProvider store={sessionStore}>
      <EditorDocumentProvider initialDocument={document} publisher={browserDocumentPublisher}>
        <EditorShell />
      </EditorDocumentProvider>
    </EditorSessionProvider>
  );
}
