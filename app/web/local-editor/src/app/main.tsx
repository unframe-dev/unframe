import { createRoot } from "react-dom/client";
import { createHostApi, takeEditorToken } from "../infra/host-api";
import { createUnityPreviewDriver } from "../infra/unity-preview";
import { createWorkspace } from "../workspace/create-workspace";
import { WorkspaceProvider } from "./workspace-provider";
import { WorkspaceShell } from "../workspace/workspace-shell";
import { readTheme, applyTheme } from "../ui/theme";
import { reuseEditorSession } from "./editor-session";
import type { Workspace } from "../workspace/create-workspace";
import type { Root } from "react-dom/client";
import "../ui/global.css";
type EditorSession = {
  token: string;
  readOnly: boolean;
  target: HTMLElement;
  workspace: Workspace;
  root: Root;
  close(): void;
};
const previous = import.meta.hot?.data.session as EditorSession | undefined;
const token = takeEditorToken() ?? previous?.token ?? null;
const target = document.getElementById("root");
if (!target) throw new Error("Editor root is missing");
const readOnly = location.pathname === "/dist-preview";
let session = reuseEditorSession(previous, token, target, readOnly);
if (!token)
  target.textContent =
    "CLI のターミナルで r + Enter を入力して Editor を開いてください。ページを再読み込みした場合も、同じ操作で開き直してください。";
else {
  if (!session) {
    const theme = readTheme();
    applyTheme(theme);
    const workspace = createWorkspace({
      api: createHostApi(token),
      theme,
      readOnly,
      createDriver: (canvas) => createUnityPreviewDriver(canvas, token),
    });
    const root = createRoot(target);
    const close = () => {
      window.removeEventListener("pagehide", onPageHide);
      root.unmount();
      workspace.dispose();
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) close();
    };
    window.addEventListener("pagehide", onPageHide);
    session = { token, readOnly, target, workspace, root, close };
    workspace.start();
  }
  session.root.render(
    <WorkspaceProvider workspace={session.workspace}>
      <WorkspaceShell />
    </WorkspaceProvider>,
  );
}
if (import.meta.hot) {
  import.meta.hot.data.session = session;
  import.meta.hot.accept();
  import.meta.hot.prune(() => session?.close());
}
