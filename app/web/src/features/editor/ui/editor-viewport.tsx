import type { Transform } from "@/features/editor/model/transform";
import { useEditorDocument } from "@/features/editor/model/editor-document-context";
import { useEditorSession } from "@/features/editor/model/editor-session-context";
import { PresentationCanvas } from "@/features/editor/ui/presentation-canvas";

export function EditorViewport() {
  const { execute, history } = useEditorDocument();
  const activeSlideId = useEditorSession((state) => state.activeSlideId);
  const selectedElementId = useEditorSession((state) => state.selectedElementId);
  const selectElement = useEditorSession((state) => state.selectElement);
  const tool = useEditorSession((state) => state.tool);
  const showGrid = useEditorSession((state) => state.showGrid);
  const snap = useEditorSession((state) => state.snap);

  const commitTransform = (elementId: string, transform: Transform) => {
    execute({ elementId, transform, type: "element.transform" });
  };

  return (
    <PresentationCanvas
      activeSlideId={activeSlideId}
      document={history.document}
      onSelect={selectElement}
      onTransform={commitTransform}
      selectedElementId={selectedElementId}
      showGrid={showGrid}
      snap={snap}
      tool={tool}
    />
  );
}
