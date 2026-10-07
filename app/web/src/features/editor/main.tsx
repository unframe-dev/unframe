import { createRoot } from "react-dom/client";
import { EditorApp } from "./editor-app";
import { createEditorApi, takeEditorToken } from "./api";
import { createUnityPreviewDriver } from "./infra/unity-preview";

const token = takeEditorToken();
const target = document.getElementById("root");
if (!target) throw new Error("Editor root is missing");
if (!token) target.textContent = "Local Host の起動時に表示された Editor URL を開いてください。";
else
  createRoot(target).render(
    <EditorApp
      api={createEditorApi(token)}
      createDriver={(canvas) => createUnityPreviewDriver(canvas, token)}
    />,
  );
