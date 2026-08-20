import { useEffect } from "react";
import { findDocumentElement } from "@/features/editor/model/find-element";
import { useEditorDocument } from "./editor-document-context";
import { useEditorSession } from "./editor-session-context";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

export function useEditorShortcuts() {
  const { history, execute, undo, redo } = useEditorDocument();
  const selectedElementId = useEditorSession((state) => state.selectedElementId);
  const selectElement = useEditorSession((state) => state.selectElement);
  const setTool = useEditorSession((state) => state.setTool);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === "Escape") {
        selectElement(null);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const location = findDocumentElement(history.document, selectedElementId);
        if (!location) return;
        event.preventDefault();
        execute({
          type: "element.remove",
          slideId: location.slideId,
          elementId: location.element.id,
        });
        selectElement(null);
        return;
      }

      const toolKey = event.key.toLowerCase();
      if (toolKey === "q") setTool("select");
      if (toolKey === "w") setTool("translate");
      if (toolKey === "e") setTool("rotate");
      if (toolKey === "r") setTool("scale");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [execute, history.document, redo, selectElement, selectedElementId, setTool, undo]);
}
