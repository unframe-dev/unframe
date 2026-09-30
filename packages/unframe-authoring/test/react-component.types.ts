import {
  defineComponent,
  definePresentation,
  editableText,
  numberProp,
  prop,
  setState,
} from "../src/index.js";

const Hero = defineComponent({
  id: "hero",
  props: { count: numberProp({ default: 1 }), title: editableText({ required: true }) },
  render: ({ bindings, props, state, texts }) => {
    const count: number = props.count;
    const title: string = texts.title;
    const binding: Readonly<Record<`data-unframe-${string}`, string>> = bindings.title;
    const initial: "default" = state;
    void count;
    void title;
    void binding;
    void initial;
    // @ts-expect-error unknown semantic node
    void texts.missing;
    return null;
  },
  semantics: {
    nodes: { title: { level: 1, order: 0, parentId: null, role: "heading", text: prop("title") } },
    rootNodeIds: ["title"],
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
});

defineComponent({
  actions: { show: { effects: [setState("shown")], inputs: {}, preconditions: [] } },
  id: "reveal",
  initialState: "hidden",
  interactions: { show: { event: "quiz.show", hitPriority: 0, kind: "click" } },
  outputs: {
    showRequested: { payload: {}, producer: { interactionId: "show", kind: "surfaceInteraction" } },
  },
  props: {},
  render: ({ bindings, state }) => {
    const current: "hidden" | "shown" = state;
    void current;
    void bindings.button;
    // @ts-expect-error state is limited to the declared finite keys
    const missing: "missing" = state;
    void missing;
    return null;
  },
  semantics: {
    nodes: {
      button: { interactionId: "show", order: 0, parentId: null, role: "button", text: "Reveal" },
    },
    rootNodeIds: ["button"],
  },
  states: {
    hidden: { enabledInteractionIds: ["show"], semanticOverrides: [] },
    shown: { enabledInteractionIds: [], semanticOverrides: [] },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});

defineComponent({
  id: "invalid-action-state",
  initialState: "hidden",
  interactions: {},
  props: {},
  semantics: {
    nodes: { label: { order: 0, parentId: null, role: "paragraph", text: "Label" } },
    rootNodeIds: ["label"],
  },
  states: { hidden: { enabledInteractionIds: [], semanticOverrides: [] } },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error Action target must be a declared State
  actions: { show: { effects: [setState("missing")], inputs: {}, preconditions: [] } },
  outputs: {},
  render: () => null,
});

defineComponent({
  id: "unsupported-output-producers",
  outputs: {
    // @ts-expect-error React metadata does not support timer outputs
    timeout: { payload: {}, producer: { afterMilliseconds: 1000, kind: "timer" } },
    // @ts-expect-error React metadata does not support timeline completion outputs
    timeline: { payload: {}, producer: { kind: "timelineCompleted", timelineId: "intro" } },
    // @ts-expect-error React metadata does not support media completion outputs
    media: { payload: {}, producer: { kind: "mediaCompleted", surfaceId: "surface" } },
  },
  props: {},
  render: () => null,
  semantics: { nodes: {}, rootNodeIds: [] },
  surface: { logicalSize: [1, 1] },
  version: 1,
});

const placement = {
  audience: { kind: "all" },
  fit: "contain",
  owner: { kind: "presentation" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
} as const;
const common = {
  assets: [],
  flow: {
    groups: {
      main: { id: "main", initialStepId: "first", steps: { first: { cues: [], id: "first" } } },
    },
    initialGroupId: "main",
    variables: {},
  },
  id: "sample",
  metadata: { title: "Sample" },
  operations: [],
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [6, 3, 6],
  },
} as const;

definePresentation({
  ...common,
  scene: [{ ...placement, component: Hero, id: "one", props: { title: "Hi" } }],
});
definePresentation({
  ...common,
  // @ts-expect-error title is required
  scene: [{ ...placement, component: Hero, id: "missing", props: {} }],
});
definePresentation({
  ...common,
  // @ts-expect-error unexpected prop key
  scene: [{ ...placement, component: Hero, id: "extra", props: { extra: true, title: "Hi" } }],
});
definePresentation({
  ...common,
  // @ts-expect-error wrong title type
  scene: [{ ...placement, component: Hero, id: "wrong", props: { title: 1 } }],
});
definePresentation({
  ...common,
  scene: [
    // @ts-expect-error unexpected scene field
    { ...placement, component: Hero, id: "extra-field", props: { title: "Hi" }, surprise: true },
  ],
});
definePresentation({
  ...common,
  // @ts-expect-error flow requires initialGroupId, groups, and variables
  flow: {},
  scene: [{ ...placement, component: Hero, id: "bad-flow", props: { title: "Hi" } }],
});
definePresentation({
  ...common,
  // @ts-expect-error assets must be asset references
  assets: [{ assetId: "bad", kind: "image" }],
  scene: [{ ...placement, component: Hero, id: "bad-asset", props: { title: "Hi" } }],
});

defineComponent({
  id: "bad-reference",
  props: { count: numberProp({ required: true }) },
  render: () => null,
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error text cannot reference a number prop
    nodes: { title: { order: 0, parentId: null, role: "paragraph", text: prop("count") } },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});

defineComponent({
  id: "heading-level-required",
  props: {},
  render: () => null,
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error heading requires a level
    nodes: { title: { order: 0, parentId: null, role: "heading", text: "Hello" } },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});
defineComponent({
  id: "paragraph-level-forbidden",
  props: {},
  render: () => null,
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error paragraph cannot have a level
    nodes: { title: { level: 1, order: 0, parentId: null, role: "paragraph", text: "Hello" } },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});

// @ts-expect-error required and default are exclusive
editableText({ default: "duplicate", required: true });
// @ts-expect-error required:false is unsupported
editableText({ default: "no", required: false });
defineComponent({
  id: "async",
  props: {},
  semantics: { nodes: {}, rootNodeIds: [] },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error initial render must be synchronous
  render: async () => null,
});
