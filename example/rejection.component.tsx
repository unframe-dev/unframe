import { defineComponent } from "@unframe-dev/authoring";
import "./style.css";

export const RejectionMark = defineComponent({
  id: "rejection-mark",
  version: 1,
  props: {},
  surface: { logicalSize: [512, 512] },
  semantics: {
    rootNodeIds: ["mark"],
    nodes: {
      mark: { role: "paragraph", parentId: null, order: 0, text: "×" },
    },
  },
  render: ({ texts, bindings }) => (
    <div className="flex h-[512px] w-[512px] items-center justify-center font-panel text-[#ff626b]">
      <p className="m-0 text-[440px] leading-none font-normal" {...bindings.mark}>
        {texts.mark}
      </p>
    </div>
  ),
});
