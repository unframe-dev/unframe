import { describe, expect, it } from "vitest";
import { createEditorSessionStore } from "./editor-session";

describe("editor session store", () => {
  it("owns selection and tools without storing the document", () => {
    const store = createEditorSessionStore("opening");

    store.getState().selectElement("demo-model-element");
    store.getState().setTool("rotate");

    expect(store.getState()).toMatchObject({
      activeSlideId: "opening",
      selectedElementId: "demo-model-element",
      tool: "rotate",
    });
    expect(store.getState()).not.toHaveProperty("document");
  });

  it("clears selection when changing slides", () => {
    const store = createEditorSessionStore("opening");
    store.getState().selectElement("demo-model-element");

    store.getState().setActiveSlide("detail");

    expect(store.getState().activeSlideId).toBe("detail");
    expect(store.getState().selectedElementId).toBeNull();
  });

  it("toggles preview and snap settings independently", () => {
    const store = createEditorSessionStore("opening");

    store.getState().setPreview(true);
    store.getState().toggleSnap();

    expect(store.getState()).toMatchObject({
      preview: true,
      snap: { enabled: true },
    });
  });
});
