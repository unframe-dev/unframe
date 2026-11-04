import { defineComponent } from "@unframe-dev/authoring";
import drawingUrl from "./assets/technology-links.png";
import "./style.css";

export const TechnologyLinks = defineComponent({
  id: "technology-links",
  version: 1,
  props: {},
  surface: { logicalSize: [1080, 600] },
  semantics: { rootNodeIds: [], nodes: {} },
  render: () => (
    <img
      width={1080}
      height={600}
      src={drawingUrl}
      alt="Control Plane、R2、Realtime、Unity、Audience Web の接続"
    />
  ),
});
