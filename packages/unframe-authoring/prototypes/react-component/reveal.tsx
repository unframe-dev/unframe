// Reveal.component.tsx
import { defineComponent, editableText, prop, setState } from "./api";

export const Reveal = defineComponent({
  actions: {
    reveal: { effects: [setState("revealed")], inputs: {}, preconditions: [] },
  },
  id: "reveal",
  initialState: "hidden",
  interactions: {
    reveal: { event: "quiz.reveal", hitPriority: 0, kind: "click" },
  },
  outputs: {
    revealRequested: {
      payload: {},
      producer: { interactionId: "reveal", kind: "surfaceInteraction" },
    },
  },
  props: {
    answer: editableText({ required: true }),
    prompt: editableText({ required: true }),
  },
  render: ({ bindings, state, texts }) => (
    <section className="reveal">
      <h1 {...bindings.prompt}>{texts.prompt}</h1>
      {state === "revealed" && <p {...bindings.answer}>{texts.answer}</p>}
      <button {...bindings.revealButton} disabled={state !== "hidden"}>
        {texts.revealButton}
      </button>
    </section>
  ),
  semantics: {
    nodes: {
      answer: {
        order: 1,
        parentId: null,
        role: "paragraph",
        text: prop("answer"),
      },
      prompt: {
        level: 1,
        order: 0,
        parentId: null,
        role: "heading",
        text: prop("prompt"),
      },
      revealButton: {
        interactionId: "reveal",
        order: 2,
        parentId: null,
        role: "button",
        text: "答えを表示",
      },
    },
    rootNodeIds: ["prompt", "answer", "revealButton"],
  },
  states: {
    hidden: {
      enabledInteractionIds: ["reveal"],
      semanticOverrides: [{ id: "hide-answer", included: false, targetId: "answer" }],
    },
    revealed: { enabledInteractionIds: [], semanticOverrides: [] },
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
});
