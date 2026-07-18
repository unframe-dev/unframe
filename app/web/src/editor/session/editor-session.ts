import { createStore, type StoreApi } from "zustand/vanilla";

export type EditorTool = "select" | "translate" | "rotate" | "scale";
export type EditorPanel = "properties" | "assets" | "none";

export interface SnapSettings {
  enabled: boolean;
  translation: number;
  rotationDegrees: number;
  scale: number;
}

export interface EditorSessionState {
  activeSlideId: string;
  selectedElementId: string | null;
  tool: EditorTool;
  panel: EditorPanel;
  preview: boolean;
  snap: SnapSettings;
  showGrid: boolean;
  selectElement: (elementId: string | null) => void;
  setActiveSlide: (slideId: string) => void;
  setTool: (tool: EditorTool) => void;
  setPanel: (panel: EditorPanel) => void;
  setPreview: (preview: boolean) => void;
  toggleSnap: () => void;
  setShowGrid: (showGrid: boolean) => void;
}

export type EditorSessionStore = StoreApi<EditorSessionState>;

export function createEditorSessionStore(activeSlideId: string): EditorSessionStore {
  return createStore<EditorSessionState>()((set) => ({
    activeSlideId,
    selectedElementId: null,
    tool: "select",
    panel: "properties",
    preview: false,
    snap: {
      enabled: false,
      translation: 0.1,
      rotationDegrees: 15,
      scale: 0.1,
    },
    showGrid: true,
    selectElement: (selectedElementId) => set({ selectedElementId }),
    setActiveSlide: (nextSlideId) => set({ activeSlideId: nextSlideId, selectedElementId: null }),
    setTool: (tool) => set({ tool }),
    setPanel: (panel) => set({ panel }),
    setPreview: (preview) => set({ preview }),
    toggleSnap: () => set((state) => ({ snap: { ...state.snap, enabled: !state.snap.enabled } })),
    setShowGrid: (showGrid) => set({ showGrid }),
  }));
}
