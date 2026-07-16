export interface EditorState {
  title: string;
  slideCount: number;
}

export function createInitialEditorState(): EditorState {
  return { title: "Untitled presentation", slideCount: 1 };
}

export function addSlide(state: EditorState): EditorState {
  return { ...state, slideCount: state.slideCount + 1 };
}
