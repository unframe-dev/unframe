import {
  defineComponent,
  definePresentation,
  editableText,
  numberProp,
  prop,
} from "../src/index.js";

const Hero = defineComponent({
  id: "hero",
  version: 1,
  props: { title: editableText({ required: true }), count: numberProp({ default: 1 }) },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["title"],
    nodes: { title: { role: "heading", level: 1, parentId: null, order: 0, text: prop("title") } },
  },
  render: ({ props, texts, bindings, state }) => {
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
});

const placement = {
  owner: { kind: "presentation" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  fit: "contain",
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
} as const;
const common = {
  id: "sample",
  metadata: { title: "Sample" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [6, 3, 6],
  },
  assets: [],
  flow: {
    initialGroupId: "main",
    groups: {
      main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
    },
    variables: {},
  },
  operations: [],
} as const;

definePresentation({
  ...common,
  scene: [{ ...placement, id: "one", component: Hero, props: { title: "Hi" } }],
});
definePresentation({
  ...common,
  // @ts-expect-error title is required
  scene: [{ ...placement, id: "missing", component: Hero, props: {} }],
});
definePresentation({
  ...common,
  // @ts-expect-error unexpected prop key
  scene: [{ ...placement, id: "extra", component: Hero, props: { title: "Hi", extra: true } }],
});
definePresentation({
  ...common,
  // @ts-expect-error wrong title type
  scene: [{ ...placement, id: "wrong", component: Hero, props: { title: 1 } }],
});
definePresentation({
  ...common,
  scene: [
    // @ts-expect-error unexpected scene field
    { ...placement, id: "extra-field", component: Hero, props: { title: "Hi" }, surprise: true },
  ],
});
definePresentation({
  ...common,
  // @ts-expect-error flow requires initialGroupId, groups, and variables
  flow: {},
  scene: [{ ...placement, id: "bad-flow", component: Hero, props: { title: "Hi" } }],
});
definePresentation({
  ...common,
  // @ts-expect-error assets must be asset references
  assets: [{ kind: "image", assetId: "bad" }],
  scene: [{ ...placement, id: "bad-asset", component: Hero, props: { title: "Hi" } }],
});

defineComponent({
  id: "bad-reference",
  version: 1,
  props: { count: numberProp({ required: true }) },
  surface: { logicalSize: [1, 1] },
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error text cannot reference a number prop
    nodes: { title: { role: "paragraph", parentId: null, order: 0, text: prop("count") } },
  },
  render: () => null,
});

defineComponent({
  id: "heading-level-required",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error heading requires a level
    nodes: { title: { role: "heading", parentId: null, order: 0, text: "Hello" } },
  },
  render: () => null,
});
defineComponent({
  id: "paragraph-level-forbidden",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error paragraph cannot have a level
    nodes: { title: { role: "paragraph", level: 1, parentId: null, order: 0, text: "Hello" } },
  },
  render: () => null,
});

// @ts-expect-error required and default are exclusive
editableText({ required: true, default: "duplicate" });
// @ts-expect-error required:false is unsupported
editableText({ required: false, default: "no" });
defineComponent({
  id: "async",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  // @ts-expect-error initial render must be synchronous
  render: async () => null,
});
