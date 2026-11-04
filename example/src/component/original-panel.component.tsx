import { defineComponent, editableText, prop, setState } from "@unframe-dev/authoring";
import "../style.css";

export const OriginalPanel = defineComponent({
  id: "original-panel",
  version: 1,
  props: {
    title: editableText({ default: "立方体のしくみ" }),
    lead: editableText({ default: "6つの面でできた立体。" }),
    detail: editableText({ default: "同じ大きさの正方形が、\nひとつの形をつくります。" }),
  },
  surface: { logicalSize: [800, 512] },
  semantics: {
    rootNodeIds: ["title", "lead", "detail", "page"],
    nodes: {
      title: { role: "heading", level: 2, parentId: null, order: 0, text: prop("title") },
      lead: { role: "paragraph", parentId: null, order: 1, text: prop("lead") },
      detail: { role: "paragraph", parentId: null, order: 2, text: prop("detail") },
      page: { role: "paragraph", parentId: null, order: 3, text: "1 / 2" },
    },
  },
  interactions: {},
  initialState: "intro",
  states: {
    intro: { semanticOverrides: [], enabledInteractionIds: [] },
    detail: {
      semanticOverrides: [
        { id: "detail-title", targetId: "title", text: "向きを変えて見る" },
        { id: "detail-lead", targetId: "lead", text: "正面から、斜めから。" },
        { id: "detail-body", targetId: "detail", text: "回してみると、\n奥行きが見えてきます。" },
        { id: "detail-page", targetId: "page", text: "2 / 2" },
      ],
      enabledInteractionIds: [],
    },
  },
  actions: { advance: { inputs: {}, preconditions: [], effects: [setState("detail")] } },
  render: ({ texts, bindings }) => (
    <article className="relative h-[512px] w-[800px] rounded-[24px] border-2 border-[#3d4151] bg-linear-to-br from-[#292d3a] to-[#1b1e28] p-[64px] font-panel font-normal text-[#f0f0f6]">
      <div
        className="absolute top-0 left-[68px] h-[4px] w-[130px] bg-linear-to-r from-[#db787b] to-[#7987fc]"
        aria-hidden="true"
      />
      <h2
        className="m-0 text-[58px] leading-[1.3] font-normal tracking-[-0.06em]"
        {...bindings.title}
      >
        {texts.title}
      </h2>
      <p className="mt-[32px] text-[32px] leading-[1.6] text-[#e3e5ef]" {...bindings.lead}>
        {texts.lead}
      </p>
      <p
        className="mt-[18px] text-[28px] leading-[1.75] whitespace-pre-line text-[#aeb4c8]"
        {...bindings.detail}
      >
        {texts.detail}
      </p>
      <p
        className="absolute right-[44px] bottom-[30px] m-0 text-[26px] tracking-[0.08em] text-[#a4abc0] tabular-nums"
        {...bindings.page}
      >
        {texts.page}
      </p>
    </article>
  ),
});
