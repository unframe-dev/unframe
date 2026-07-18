import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import type { DocumentStream } from "../../viewer/stream/broadcast-channel-document-stream";
import { createDocumentEvent } from "../../viewer/stream/document-event";
import type { EditorCommand } from "../commands/editor-command";
import {
  createHistoryState,
  executeCommand,
  redoCommand,
  undoCommand,
  type HistoryState,
} from "../history/history";

export type SyncStatus = "ready" | "publishing" | "error";

interface EditorDocumentValue {
  history: HistoryState;
  syncStatus: SyncStatus;
  execute: (command: EditorCommand) => void;
  undo: () => void;
  redo: () => void;
}

const EditorDocumentContext = createContext<EditorDocumentValue | null>(null);

export function EditorDocumentProvider({
  initialDocument,
  stream,
  children,
}: PropsWithChildren<{
  initialDocument: PresentationDocument;
  stream: DocumentStream;
}>) {
  const [history, setHistory] = useState(() => createHistoryState(initialDocument));
  const historyRef = useRef(history);
  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPublicationsRef = useRef(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("ready");

  const publish = useCallback(
    (before: PresentationDocument, command: EditorCommand) => {
      setSyncStatus("publishing");
      pendingPublicationsRef.current += 1;
      const event = createDocumentEvent(before, command);
      const publication = publishQueueRef.current
        .catch(() => undefined)
        .then(() => stream.publish(event));
      publishQueueRef.current = publication;
      void publication
        .then(() => {
          pendingPublicationsRef.current -= 1;
          if (pendingPublicationsRef.current === 0) setSyncStatus("ready");
        })
        .catch(() => {
          pendingPublicationsRef.current -= 1;
          setSyncStatus("error");
        });
    },
    [stream],
  );

  const commit = useCallback(
    (next: HistoryState, command: EditorCommand) => {
      const before = historyRef.current.document;
      historyRef.current = next;
      setHistory(next);
      publish(before, command);
    },
    [publish],
  );

  const execute = useCallback(
    (command: EditorCommand) => {
      commit(executeCommand(historyRef.current, command), command);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const entry = historyRef.current.undoStack.at(-1);
    if (!entry) return;
    commit(undoCommand(historyRef.current), entry.inverse);
  }, [commit]);

  const redo = useCallback(() => {
    const entry = historyRef.current.redoStack.at(-1);
    if (!entry) return;
    commit(redoCommand(historyRef.current), entry.command);
  }, [commit]);

  return (
    <EditorDocumentContext.Provider value={{ history, syncStatus, execute, undo, redo }}>
      {children}
    </EditorDocumentContext.Provider>
  );
}

export function useEditorDocument(): EditorDocumentValue {
  const value = useContext(EditorDocumentContext);
  if (!value) {
    throw new Error("useEditorDocument must be used within EditorDocumentProvider");
  }
  return value;
}
