import { defineComponent, editableText, prop } from "./api";

export const Hero = defineComponent({
  id: "hero",
  version: 1,
  props: { title: editableText({ required: true }) },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["title"],
    nodes: {
      title: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("title"),
      },
    },
  },
  render: ({ texts, bindings }) => (
    <section className="hero">
      <h1 {...bindings.title}>{texts.title}</h1>
    </section>
  ),
});
