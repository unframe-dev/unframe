import { defineComponent, editableText, prop } from "@unframe-dev/authoring";
import "../style.css";

export const OpeningBrand = defineComponent({
  id: "opening-brand",
  version: 1,
  props: { wordmark: editableText({ default: "Unframe" }) },
  surface: { logicalSize: [320, 110] },
  semantics: {
    rootNodeIds: ["wordmark"],
    nodes: {
      wordmark: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("wordmark"),
      },
    },
  },
  render: ({ texts, bindings }) => (
    <div className="flex h-[110px] w-[320px] items-center justify-center font-brand text-[#f3f3f7]">
      <h1
        className="m-0 text-[84px] leading-none font-normal tracking-[-4px]"
        {...bindings.wordmark}
      >
        {texts.wordmark}
      </h1>
    </div>
  ),
});
