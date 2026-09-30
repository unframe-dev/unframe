import { createStore, type StoreApi } from "zustand/vanilla";

export type EditorTool = "select" | "translate" | "rotate" | "scale";
export type EditorPanel = "properties" | "assets" | "none";

export interface SnapSettings {
  enabled: boolean;
  rotationDegrees: number;
  scale: number;
  translation: number;
}

export interface EditorSessionState {
  activeSlideId: string;
  panel: EditorPanel;
  preview: boolean;
  selectedElementId: string | null;
  selectElement: (elementId: string | null) => void;
  setActiveSlide: (slideId: string) => void;
  setPanel: (panel: EditorPanel) => void;
  setPreview: (preview: boolean) => void;
  setShowGrid: (showGrid: boolean) => void;
  setTool: (tool: EditorTool) => void;
  showGrid: boolean;
  snap: SnapSettings;
  toggleSnap: () => void;
  tool: EditorTool;
}

export type EditorSessionStore = StoreApi<EditorSessionState>;

export function createEditorSessionStore(activeSlideId: string): EditorSessionStore {
  return createStore<EditorSessionState>()((set) => ({
    activeSlideId,
    panel: "properties",
    preview: false,
    selectedElementId: null,
    selectElement: (selectedElementId) => set({ selectedElementId }),
    setActiveSlide: (nextSlideId) => set({ activeSlideId: nextSlideId, selectedElementId: null }),
    setPanel: (panel) => set({ panel }),
    setPreview: (preview) => set({ preview }),
    setShowGrid: (showGrid) => set({ showGrid }),
    setTool: (tool) => set({ tool }),
    showGrid: true,
    snap: {
      enabled: false,
      rotationDegrees: 15,
      scale: 0.1,
      translation: 0.1,
    },
    toggleSnap: () => set((state) => ({ snap: { ...state.snap, enabled: !state.snap.enabled } })),
    tool: "select",
  }));
}
