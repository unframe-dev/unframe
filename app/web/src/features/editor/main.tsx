import { createRoot } from "react-dom/client";
import { EditorApp } from "./editor-app";
import { createEditorApi, takeEditorToken } from "./api";
import { createUnityPreviewDriver } from "./infra/unity-preview";

const token = takeEditorToken();
const target = document.getElementById("root");
if (!target) throw new Error("Editor root is missing");
if (!token)
  target.textContent =
    "CLI のターミナルで r + Enter を入力して Editor を開いてください。ページを再読み込みした場合も、同じ操作で開き直してください。";
else
  createRoot(target).render(
    <EditorApp
      api={createEditorApi(token)}
      createDriver={(canvas) => createUnityPreviewDriver(canvas, token)}
    />,
  );
