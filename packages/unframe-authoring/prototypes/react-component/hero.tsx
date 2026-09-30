import { defineComponent, editableText, prop } from "./api";

export const Hero = defineComponent({
  id: "hero",
  props: { title: editableText({ required: true }) },
  render: ({ bindings, texts }) => (
    <section className="hero">
      <h1 {...bindings.title}>{texts.title}</h1>
    </section>
  ),
  semantics: {
    nodes: {
      title: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("title"),
      },
    },
    rootNodeIds: ["title"],
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
});
