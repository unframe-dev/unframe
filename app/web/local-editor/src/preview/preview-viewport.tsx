import { useLayoutEffect, useRef } from "react";
import { useWorkspace } from "../app/workspace-provider";
import { retainPreviewCanvas } from "../app/viewport-canvas";
export function PreviewViewport() {
  const w = useWorkspace();
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) return;
    const canvas = retainPreviewCanvas(w, () => {
      const element = document.createElement("canvas");
      element.id = "unity-preview-canvas";
      element.setAttribute("aria-label", "Unity Preview");
      element.tabIndex = 0;
      return element;
    });
    parent.appendChild(canvas);
    w.connectViewport(canvas);
    return () => canvas.remove();
  }, [w]);
  return <div className="preview-stage" ref={container} />;
}
