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
  version: 1,
  props: {
    caption: stringProp({ default: "fallback" }),
    count: numberProp({ required: true }),
    visible: booleanProp({ default: false }),
  },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["caption"],
    nodes: { caption: { role: "paragraph", parentId: null, order: 0, text: prop("caption") } },
  },
  render: ({ props, texts, bindings, state }) => {
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
  id: "types",
  metadata: { title: "types" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [6, 3, 6],
  },
  assets: [],
  flow: {},
  operations: [],
} as const;

definePresentation({
  ...common,
  scene: [{ ...placement, id: "valid-optional", component: optional, props: { count: 1 } }],
});
definePresentation({
  ...common,
  // @ts-expect-error required title is missing
  scene: [{ ...placement, id: "missing", component: Hero, props: {} }],
});
definePresentation({
  ...common,
  // @ts-expect-error title has the wrong type
  scene: [{ ...placement, id: "wrong-type", component: Hero, props: { title: 1 } }],
});
definePresentation({
  ...common,
  // @ts-expect-error extra key must be rejected
  scene: [{ ...placement, id: "extra", component: Hero, props: { title: "ok", surprise: true } }],
});
definePresentation({
  ...common,
  scene: [
    { ...placement, id: "hero", component: Hero, props: { title: "ok" } },
    // @ts-expect-error Reveal requires answer even in a heterogeneous scene
    { ...placement, id: "reveal", component: Reveal, props: { prompt: "question" } },
  ],
});

defineComponent({
  id: "bad-prop",
  version: 1,
  props: { title: editableText({ required: true }) },
  surface: { logicalSize: [1, 1] },
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error undeclared Prop reference
    nodes: { title: { role: "heading", parentId: null, order: 0, text: prop("missing") } },
  },
  render: () => null,
});
defineComponent({
  id: "number-text",
  version: 1,
  props: { count: numberProp({ required: true }) },
  surface: { logicalSize: [1, 1] },
  semantics: {
    rootNodeIds: ["title"],
    // @ts-expect-error a number Prop is not valid heading text
    nodes: { title: { role: "heading", parentId: null, order: 0, text: prop("count") } },
  },
  render: () => null,
});
defineComponent({
  id: "no-initial",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  // @ts-expect-error declaring states requires initialState
  states: { ready: { semanticOverrides: [], enabledInteractionIds: [] } },
  render: () => null,
});
defineComponent({
  id: "bad-initial",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  // @ts-expect-error initialState must name a declared state
  initialState: "missing",
  states: { ready: { semanticOverrides: [], enabledInteractionIds: [] } },
  render: () => null,
});
defineComponent({
  id: "bad-action",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  initialState: "ready",
  states: { ready: { semanticOverrides: [], enabledInteractionIds: [] } },
  // @ts-expect-error state helper must reference a declared state
  actions: { go: { inputs: {}, preconditions: [], effects: [setState("missing")] } },
  render: () => null,
});
defineComponent({
  id: "mixed-action",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  initialState: "ready",
  states: { ready: { semanticOverrides: [], enabledInteractionIds: [] } },
  actions: {
    // @ts-expect-error every effect must reference a declared state
    go: { inputs: {}, preconditions: [], effects: [setState("ready"), setState("missing")] },
  },
  render: () => null,
});

// @ts-expect-error required and default are exclusive
editableText({ required: true, default: "duplicate" });
// @ts-expect-error required:false is outside the Prop contract
stringProp({ required: false, default: "invalid" });
// @ts-expect-error a Prop needs required:true or a default
numberProp({});
// @ts-expect-error default has the wrong value type
booleanProp({ default: "yes" });
defineComponent({
  id: "async",
  version: 1,
  props: {},
  surface: { logicalSize: [1, 1] },
  semantics: { rootNodeIds: [], nodes: {} },
  // @ts-expect-error initial render is synchronous
  render: async () => <p>late</p>,
});
