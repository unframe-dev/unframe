// Reveal.component.tsx
import { defineComponent, editableText, prop, setState } from "./api";

export const Reveal = defineComponent({
  id: "reveal",
  version: 1,
  props: {
    prompt: editableText({ required: true }),
    answer: editableText({ required: true }),
  },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["prompt", "answer", "revealButton"],
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
  },
  interactions: {
    reveal: { kind: "click", event: "quiz.reveal", hitPriority: 0 },
  },
  initialState: "hidden",
  states: {
    hidden: {
      semanticOverrides: [{ id: "hide-answer", targetId: "answer", included: false }],
      enabledInteractionIds: ["reveal"],
    },
    revealed: { semanticOverrides: [], enabledInteractionIds: [] },
  },
  actions: {
    reveal: { inputs: {}, preconditions: [], effects: [setState("revealed")] },
  },
  outputs: {
    revealRequested: {
      payload: {},
      producer: { kind: "surfaceInteraction", interactionId: "reveal" },
    },
  },
  render: ({ texts, bindings, state }) => (
    <section className="reveal">
      <h1 {...bindings.prompt}>{texts.prompt}</h1>
      {state === "revealed" && <p {...bindings.answer}>{texts.answer}</p>}
      <button {...bindings.revealButton} disabled={state !== "hidden"}>
        {texts.revealButton}
      </button>
    </section>
  ),
});
