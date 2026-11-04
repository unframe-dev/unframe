import { defineComponent, editableText, prop } from "@unframe-dev/authoring";
import "./style.css";

export const SpatialWord = defineComponent({
  id: "spatial-word",
  version: 1,
  props: { text: editableText({ default: "話す" }) },
  surface: { logicalSize: [720, 200] },
  semantics: {
    rootNodeIds: ["text"],
    nodes: { text: { role: "paragraph", parentId: null, order: 0, text: prop("text") } },
  },
  render: ({ texts, bindings }) => (
    <div className="flex h-[200px] w-[720px] items-center justify-center font-panel text-[#f3f3f7]">
      <p
        className="m-0 text-center text-[64px] leading-[1.45] whitespace-pre-line"
        {...bindings.text}
      >
        {texts.text}
      </p>
    </div>
  ),
});
