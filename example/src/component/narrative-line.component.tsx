import { defineComponent, editableText, prop } from "@unframe-dev/authoring";
import "../style.css";

export const NarrativeLine = defineComponent({
  id: "narrative-line",
  version: 1,
  props: { text: editableText({ default: "" }) },
  surface: { logicalSize: [1280, 160] },
  semantics: {
    rootNodeIds: ["text"],
    nodes: { text: { role: "paragraph", parentId: null, order: 0, text: prop("text") } },
  },
  render: ({ texts, bindings }) => (
    <div className="flex h-[160px] w-[1280px] items-center justify-center font-panel text-[#f3f3f7]">
      <p className="m-0 text-center text-[64px] leading-none whitespace-nowrap" {...bindings.text}>
        {texts.text}
      </p>
    </div>
  ),
});
