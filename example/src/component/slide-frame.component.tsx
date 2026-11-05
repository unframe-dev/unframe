import { defineComponent } from "@unframe-dev/authoring";
import "../style.css";

export const SlideFrame = defineComponent({
  id: "slide-frame",
  version: 1,
  props: {},
  surface: { logicalSize: [480, 540] },
  semantics: { rootNodeIds: [], nodes: {} },
  render: () => (
    <div
      style={{
        width: 480,
        height: 540,
        boxSizing: "border-box",
        borderLeft: "5px solid #9baaff",
        borderTop: "5px solid #9baaff",
        borderBottom: "5px solid #9baaff",
        borderRadius: "18px 0 0 18px",
      }}
    />
  ),
});
