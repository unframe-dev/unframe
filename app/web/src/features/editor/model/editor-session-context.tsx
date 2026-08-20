import { createContext, useContext, type PropsWithChildren } from "react";
import { useStore } from "zustand";
import type { EditorSessionState, EditorSessionStore } from "./editor-session";

const EditorSessionContext = createContext<EditorSessionStore | null>(null);

export function EditorSessionProvider({
  store,
  children,
}: PropsWithChildren<{ store: EditorSessionStore }>) {
  return <EditorSessionContext.Provider value={store}>{children}</EditorSessionContext.Provider>;
}

export function useEditorSession<T>(selector: (state: EditorSessionState) => T): T {
  const store = useContext(EditorSessionContext);
  if (!store) {
    throw new Error("useEditorSession must be used within EditorSessionProvider");
  }
  return useStore(store, selector);
}
