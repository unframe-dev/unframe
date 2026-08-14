import { useEffect, useState } from "react";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import { EditorDocumentProvider } from "../../editor/document/editor-document-context";
import { createEditorSessionStore, type EditorPanel } from "../../editor/session/editor-session";
import { EditorSessionProvider } from "../../editor/session/editor-session-context";
import { browserDocumentStream } from "../../app/runtime/document-runtime";
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
      <EditorDocumentProvider initialDocument={document} stream={browserDocumentStream}>
        <EditorShell />
      </EditorDocumentProvider>
    </EditorSessionProvider>
  );
}
