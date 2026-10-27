import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Workspace } from "../workspace/create-workspace";
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) {
  useEffect(() => {
    workspace.start();
    return () => workspace.dispose();
  }, [workspace]);
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const workspace = useContext(Context);
  if (!workspace) throw new Error("Workspace provider is missing");
  return workspace;
}
