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
      prompt: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: prop("prompt"),
      },
      answer: {
        role: "paragraph",
        parentId: null,
        order: 1,
        text: prop("answer"),
      },
      revealButton: {
        role: "button",
        parentId: null,
        order: 2,
        text: "答えを表示",
        interactionId: "reveal",
      },
    },
    rootNodeIds: ["prompt", "answer", "revealButton"],
  },
  states: {
    hidden: {
      enabledInteractionIds: ["reveal"],
      semanticOverrides: [{ id: "hide-answer", targetId: "answer", included: false }],
    },
    revealed: { enabledInteractionIds: [], semanticOverrides: [] },
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
});
