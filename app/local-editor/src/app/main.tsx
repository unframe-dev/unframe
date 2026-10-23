import { createRoot } from "react-dom/client";
import { createHostApi, takeEditorToken } from "../infra/host-api";
import { createUnityPreviewDriver } from "../infra/unity-preview";
import { createWorkspace } from "../workspace/create-workspace";
import { WorkspaceProvider } from "./workspace-provider";
import { WorkspaceShell } from "../workspace/workspace-shell";
import { readTheme, applyTheme } from "../ui/theme";
import "../ui/global.css";
const token = takeEditorToken();
const target = document.getElementById("root");
if (!target) throw new Error("Editor root is missing");
if (!token)
  target.textContent =
    "CLI のターミナルで r + Enter を入力して Editor を開いてください。ページを再読み込みした場合も、同じ操作で開き直してください。";
else {
  const theme = readTheme();
  applyTheme(theme);
  const workspace = createWorkspace({
    api: createHostApi(token),
    theme,
    createDriver: (canvas) => createUnityPreviewDriver(canvas, token),
  });
  createRoot(target).render(
    <WorkspaceProvider workspace={workspace}>
      <WorkspaceShell />
    </WorkspaceProvider>,
  );
}
