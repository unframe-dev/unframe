import { useEffect, useRef } from "react";
import { useWorkspace } from "../app/workspace-provider";
export function PreviewViewport() {
  const w = useWorkspace();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) w.connectViewport(canvas.current);
  }, [w]);
  return (
    <div className="preview-stage">
      <canvas id="unity-preview-canvas" ref={canvas} aria-label="Unity Preview" tabIndex={0} />
    </div>
  );
}
