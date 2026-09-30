import {
  booleanProp,
  defineComponent,
  definePresentation,
  editableText,
  numberProp,
  prop,
  setState,
  stringProp,
} from "./api";
import { Hero } from "./hero";
import { Reveal } from "./reveal";
import example from "./presentation";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HeroProps = NonNullable<(typeof Hero)["__props"]>;
type RevealStates = NonNullable<(typeof Reveal)["__states"]>;
type HeroScene = (typeof example.scene)[0];
type RevealScene = (typeof example.scene)[2];
type _HeroTitle = Assert<Equal<HeroProps["title"]["__value"], string | undefined>>;
type _HeroNotAny = Assert<Equal<IsAny<HeroScene["props"]["title"]>, false>>;
type _RevealNotAny = Assert<Equal<IsAny<RevealScene["props"]["answer"]>, false>>;
type _States = Assert<Equal<keyof RevealStates, "hidden" | "revealed">>;

const optional = defineComponent({
  id: "optional",
  props: {
    caption: stringProp({ default: "fallback" }),
    count: numberProp({ required: true }),
    visible: booleanProp({ default: false }),
  },
  render: ({ bindings, props, state, texts }) => {
    const count: number = props.count;
    const caption: string = props.caption;
    const visible: boolean = props.visible;
    const text: string = texts.caption;
    const binding: Readonly<Record<`data-unframe-${string}`, string>> = bindings.caption;
    const initial: "default" = state;
    // @ts-expect-error the implicit state is exactly "default"
    const otherState: "ready" = state;
    void count;
    void caption;
    void visible;
    void text;
    void binding;
    void initial;
    void otherState;
    // @ts-expect-error count is a number, not text
    const wrongText: string = props.count;
    // @ts-expect-error unknown text node
    void texts.missing;
    // @ts-expect-error unknown binding node
    void bindings.missing;
    return <p {...bindings.caption}>{texts.caption}</p>;
  },
  semantics: {
    nodes: { caption: { role: "paragraph", parentId: null, order: 0, text: prop("caption") } },
    rootNodeIds: ["caption"],
  },
  surface: { logicalSize: [960, 540] },
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
  flow: {},
  id: "types",
  metadata: { title: "types" },
  operations: [],
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [6, 3, 6],
  },
} as const;

definePresentation({
  ...common,
  scene: [{ ...placement, component: optional, id: "valid-optional", props: { count: 1 } }],
});
definePresentation({
  ...common,
  // @ts-expect-error required title is missing
  scene: [{ ...placement, component: Hero, id: "missing", props: {} }],
});
definePresentation({
  ...common,
  // @ts-expect-error title has the wrong type
  scene: [{ ...placement, component: Hero, id: "wrong-type", props: { title: 1 } }],
});
definePresentation({
  ...common,
  // @ts-expect-error extra key must be rejected
  scene: [{ ...placement, component: Hero, id: "extra", props: { surprise: true, title: "ok" } }],
});
definePresentation({
  ...common,
  scene: [
    { ...placement, component: Hero, id: "hero", props: { title: "ok" } },
    // @ts-expect-error Reveal requires answer even in a heterogeneous scene
    { ...placement, component: Reveal, id: "reveal", props: { prompt: "question" } },
  ],
});

defineComponent({
  id: "bad-prop",
  props: { title: editableText({ required: true }) },
  render: () => null,
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error undeclared Prop reference
    nodes: { title: { order: 0, parentId: null, role: "heading", text: prop("missing") } },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});
defineComponent({
  id: "number-text",
  props: { count: numberProp({ required: true }) },
  render: () => null,
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error a number Prop is not valid heading text
    nodes: { title: { order: 0, parentId: null, role: "heading", text: prop("count") } },
  },
  surface: { logicalSize: [1, 1] },
  version: 1,
});
defineComponent({
  id: "no-initial",
  props: {},
  semantics: { nodes: {}, rootNodeIds: [] },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error declaring states requires initialState
  render: () => null,
  states: { ready: { enabledInteractionIds: [], semanticOverrides: [] } },
});
defineComponent({
  id: "bad-initial",
  props: {},
  semantics: { nodes: {}, rootNodeIds: [] },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error initialState must name a declared state
  initialState: "missing",
  render: () => null,
  states: { ready: { enabledInteractionIds: [], semanticOverrides: [] } },
});
defineComponent({
  id: "bad-action",
  initialState: "ready",
  props: {},
  semantics: { nodes: {}, rootNodeIds: [] },
  states: { ready: { enabledInteractionIds: [], semanticOverrides: [] } },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error state helper must reference a declared state
  actions: { go: { effects: [setState("missing")], inputs: {}, preconditions: [] } },
  render: () => null,
});
defineComponent({
  actions: {
    // @ts-expect-error every effect must reference a declared state
    go: { effects: [setState("ready"), setState("missing")], inputs: {}, preconditions: [] },
  },
  id: "mixed-action",
  initialState: "ready",
  props: {},
  render: () => null,
  semantics: { nodes: {}, rootNodeIds: [] },
  states: { ready: { enabledInteractionIds: [], semanticOverrides: [] } },
  surface: { logicalSize: [1, 1] },
  version: 1,
});

// @ts-expect-error required and default are exclusive
editableText({ default: "duplicate", required: true });
// @ts-expect-error required:false is outside the Prop contract
stringProp({ default: "invalid", required: false });
// @ts-expect-error a Prop needs required:true or a default
numberProp({});
// @ts-expect-error default has the wrong value type
booleanProp({ default: "yes" });
defineComponent({
  id: "async",
  props: {},
  semantics: { nodes: {}, rootNodeIds: [] },
  surface: { logicalSize: [1, 1] },
  version: 1,
  // @ts-expect-error initial render is synchronous
  render: async () => <p>late</p>,
});
