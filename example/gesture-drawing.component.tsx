import { defineComponent } from "@unframe-dev/authoring";
import drawingUrl from "./assets/gesture-drawing.png";
import "./style.css";

export const GestureDrawing = defineComponent({
  id: "gesture-drawing",
  version: 1,
  props: {},
  surface: { logicalSize: [600, 360] },
  semantics: { rootNodeIds: [], nodes: {} },
  render: () => <img width={600} height={360} src={drawingUrl} alt="両手から空間へ広がる軌跡" />,
});
