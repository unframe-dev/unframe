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
        level: 1,
        order: 0,
        parentId: null,
        role: "heading",
        text: prop("title"),
      },
    },
    rootNodeIds: ["title"],
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
});
