import { fileURLToPath } from "node:url";

export const editorAssetsDirectory = fileURLToPath(new URL("./dist/", import.meta.url));
export const unityPreviewDirectory = fileURLToPath(new URL("./player/", import.meta.url));
