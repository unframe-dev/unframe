import type { ReactElement } from "react";
import { z } from "zod";
import type {
  ComponentManifest,
  PresentationDeclaration,
  ComponentInstanceDeclaration,
  PropDeclaration,
  SemanticNodeDeclaration,
  ActionDeclaration,
  OutputDeclaration,
  SurfaceStateDeclaration,
} from "../domain/declarations.js";
import { readOwnDataRecord, snapshotDeclaration } from "../internal/declaration-validation.js";
import { defineComponentManifest, stringProp } from "./definitions.js";

type AnyProp =
  | PropDeclaration
  | ({ kind: "string"; editor: { kind: "text" } } & (
      | { required: true; default?: never }
      | { default: string; required?: never }
    ));
type PropValue<D> = D extends { kind: "string" }
  ? string
  : D extends { kind: "number" }
    ? number
    : D extends { kind: "boolean" }
      ? boolean
      : never;
type RequiredKeys<P> = { [K in keyof P]: P[K] extends { required: true } ? K : never }[keyof P];
export type ReactComponentInstanceProps<P> = {
  readonly [K in RequiredKeys<P>]: PropValue<P[K]>;
} & {
  readonly [K in Exclude<keyof P, RequiredKeys<P>>]?: PropValue<P[K]>;
};
type ResolvedProps<P> = { readonly [K in keyof P]-?: PropValue<P[K]> };
type StringKeys<P> = { [K in keyof P]: PropValue<P[K]> extends string ? K : never }[keyof P] &
  string;

export type ComponentPropReference<K extends string> = {
  readonly kind: "prop-ref";
  readonly name: K;
};
export const prop = <const K extends string>(name: K): ComponentPropReference<K> => ({
  kind: "prop-ref",
  name,
});
export function editableText(value: { required: true; default?: never }): {
  kind: "string";
  required: true;
  editor: { kind: "text" };
};
export function editableText(value: { default: string; required?: never }): {
  kind: "string";
  default: string;
  editor: { kind: "text" };
};
export function editableText(value: { required: true } | { default: string }) {
  return { ...stringProp(value), editor: { kind: "text" as const } };
}

type SemanticNode = (
  | { readonly role: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly role: "button"; readonly interactionId: string; readonly level?: never }
  | {
      readonly role: "paragraph";
      readonly level?: never;
    }
) & {
  readonly parentId: string | null;
  readonly order: number;
  readonly text: string | ComponentPropReference<string>;
};
type ValidateNode<P, N> = N extends { text: ComponentPropReference<infer K> }
  ? K extends StringKeys<P>
    ? unknown
    : never
  : unknown;
type ValidateNodes<P, N> = { readonly [K in keyof N]: ValidateNode<P, N[K]> };
type TextKeys<N> = keyof N & string;
type Binding = { readonly [attribute: `data-unframe-${string}`]: string };
type SyncReactNode =
  | ReactElement
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly SyncReactNode[];
type RenderContext<P, N, S extends string> = {
  readonly props: ResolvedProps<P>;
  readonly texts: Readonly<Record<TextKeys<N>, string>>;
  readonly bindings: Readonly<Record<keyof N, Binding>>;
  readonly state: S;
};
type StateInput = {
  readonly semanticOverrides: readonly Omit<
    import("../domain/declarations.js").SemanticOverrideDeclaration,
    "kind"
  >[];
  readonly enabledInteractionIds: readonly string[];
};
type InteractionInput = Omit<import("../domain/declarations.js").InteractionDeclaration, "id">;
type ActionInput<S extends string> = Omit<
  ActionDeclaration,
  "kind" | "effects" | "preconditions"
> & {
  readonly preconditions: readonly [];
  readonly effects: readonly { kind: "setState"; stateId: S }[];
};
type OutputInput = Omit<OutputDeclaration, "kind" | "producer"> & {
  readonly producer: Extract<OutputDeclaration["producer"], { kind: "surfaceInteraction" }>;
};
export type ReactComponent<P, N, S extends string = "default"> = {
  readonly id: string;
  readonly version: number;
  readonly props: P;
  readonly surface: { readonly logicalSize: readonly [number, number] };
  readonly semantics: { readonly rootNodeIds: readonly (keyof N & string)[]; readonly nodes: N };
  readonly interactions?: Readonly<Record<string, InteractionInput>>;
  readonly initialState?: NoInfer<S>;
  readonly states?: Readonly<Record<S, StateInput>>;
  readonly actions?: Readonly<Record<string, ActionInput<S>>>;
  readonly outputs?: Readonly<Record<string, OutputInput>>;
  readonly render: (input: RenderContext<P, N, S>) => SyncReactNode;
  readonly __props?: P;
};

export type ReactSceneBase = {
  readonly id: string;
  readonly component: {
    readonly id: string;
    readonly version: number;
    readonly __props?: Record<string, AnyProp>;
  };
  readonly props: object;
  readonly owner: { readonly kind: "presentation" };
  readonly audience: { readonly kind: "all" };
  readonly parent: { readonly kind: "stage" };
  readonly physicalSizeMeters: readonly [number, number];
  readonly fit: "contain";
  readonly transform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
  };
};
type CheckSceneItem<I> = I extends {
  component: { readonly __props?: infer P };
  props: infer Actual;
}
  ? Exclude<keyof I, keyof ReactSceneBase> extends never
    ? Actual extends ReactComponentInstanceProps<P>
      ? Exclude<keyof Actual, keyof ReactComponentInstanceProps<P>> extends never
        ? unknown
        : never
      : never
    : never
  : never;
type CheckScene<S> = { readonly [K in keyof S]: S[K] & CheckSceneItem<S[K]> };
export type ReactPresentationInput<S extends readonly ReactSceneBase[]> = Omit<
  PresentationDeclaration,
  "scene"
> & {
  readonly scene: S & CheckScene<S>;
};
export type MixedPresentationInput<
  S extends readonly (ComponentInstanceDeclaration | ReactSceneBase)[],
> = Omit<PresentationDeclaration, "scene"> & {
  readonly scene: Omit<PresentationDeclaration["scene"], "components"> & {
    readonly components: S & {
      readonly [K in keyof S]: S[K] extends ReactSceneBase ? S[K] & CheckSceneItem<S[K]> : S[K];
    };
  };
};

export const defineComponent = <
  const P extends Record<string, AnyProp>,
  const N extends Record<string, SemanticNode>,
  const S extends Record<string, StateInput> = Record<"default", StateInput>,
>(value: {
  readonly id: string;
  readonly version: number;
  readonly props: P;
  readonly surface: { readonly logicalSize: readonly [number, number] };
  readonly semantics: {
    readonly rootNodeIds: readonly (keyof N & string)[];
    readonly nodes: N & ValidateNodes<P, N>;
  };
  readonly interactions?: Readonly<Record<string, InteractionInput>>;
  readonly initialState?: keyof S & string;
  readonly states?: S;
  readonly actions?: Readonly<Record<string, ActionInput<NoInfer<keyof S & string>>>>;
  readonly outputs?: Readonly<Record<string, OutputInput>>;
  readonly render: (input: RenderContext<P, N, keyof S & string>) => SyncReactNode;
}): ReactComponent<P, N, keyof S & string> => {
  validateRuntimeReactComponent(value);
  return value;
};

export const setState = <const S extends string>(stateId: S) => ({
  kind: "setState" as const,
  stateId,
});

const id = z.string().min(1);
const positive = z.number().finite().positive();
const propSchema = z.union([
  z.strictObject({
    kind: z.literal("string"),
    required: z.literal(true),
    editor: z.strictObject({ kind: z.literal("text") }).optional(),
  }),
  z.strictObject({
    kind: z.literal("string"),
    default: z.string(),
    editor: z.strictObject({ kind: z.literal("text") }).optional(),
  }),
  z.strictObject({ kind: z.literal("number"), required: z.literal(true) }),
  z.strictObject({ kind: z.literal("number"), default: z.number().finite() }),
  z.strictObject({ kind: z.literal("boolean"), required: z.literal(true) }),
  z.strictObject({ kind: z.literal("boolean"), default: z.boolean() }),
]);
const text = z.union([
  z.string().min(1),
  z.strictObject({ kind: z.literal("prop-ref"), name: id }),
]);
const nodeSchema = z.union([
  z.strictObject({
    role: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    parentId: id.nullable(),
    order: z.number().int().nonnegative(),
    text,
  }),
  z.strictObject({
    role: z.literal("paragraph"),
    parentId: id.nullable(),
    order: z.number().int().nonnegative(),
    text,
  }),
  z.strictObject({
    role: z.literal("button"),
    interactionId: id,
    parentId: id.nullable(),
    order: z.number().int().nonnegative(),
    text,
  }),
]);
const semanticOverrideInputSchema = z.strictObject({
  id,
  targetId: id,
  included: z.boolean().optional(),
  text: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});
const finiteStateSchema = z.strictObject({
  semanticOverrides: z.array(semanticOverrideInputSchema),
  enabledInteractionIds: z.array(id),
});
const actionInputSchema = z.strictObject({
  inputs: z.record(id, z.enum(["null", "boolean", "number", "string"])),
  preconditions: z.tuple([]),
  effects: z.array(z.strictObject({ kind: z.literal("setState"), stateId: id })).min(1),
});
const outputPayloadFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("null"), value: z.null() }),
  z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ type: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ type: z.literal("string"), value: z.string() }),
]);
const metadataSchema = z.strictObject({
  id,
  version: z.number().int().safe().positive(),
  props: z.record(id, propSchema),
  surface: z.strictObject({ logicalSize: z.tuple([positive, positive]) }),
  semantics: z.strictObject({ rootNodeIds: z.array(id), nodes: z.record(id, nodeSchema) }),
  interactions: z
    .record(
      id,
      z.strictObject({
        kind: z.literal("click"),
        event: id,
        hitPriority: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  initialState: id.optional(),
  states: z.record(id, finiteStateSchema).optional(),
  actions: z.record(id, actionInputSchema).optional(),
  outputs: z
    .record(
      id,
      z.strictObject({
        payload: z.record(id, outputPayloadFieldSchema),
        producer: z.strictObject({ kind: z.literal("surfaceInteraction"), interactionId: id }),
      }),
    )
    .optional(),
});
export type StaticComponentMetadata = z.infer<typeof metadataSchema>;

export const validateRuntimeReactComponent = (value: unknown): StaticComponentMetadata => {
  const fields = readOwnDataRecord(value);
  if (typeof fields.render !== "function")
    throw new TypeError("Component render must be a function.");
  delete fields.render;
  return validateStaticComponentMetadata(fields);
};

export const resolveReactComponentProps = (
  component: unknown,
  props: unknown,
): Record<string, string | number | boolean> => {
  const metadata = validateRuntimeReactComponent(component);
  const raw = readOwnDataRecord(snapshotDeclaration(props));
  const resolved = Object.create(null) as Record<string, string | number | boolean>;
  for (const key of Object.keys(raw))
    if (!Object.hasOwn(metadata.props, key)) throw new TypeError(`Unknown component prop: ${key}`);
  for (const [key, declaration] of Object.entries(metadata.props)) {
    const value =
      key in raw ? raw[key] : "default" in declaration ? declaration.default : undefined;
    if (value === undefined) throw new TypeError(`Missing required component prop: ${key}`);
    const schema =
      declaration.kind === "string"
        ? z.string()
        : declaration.kind === "number"
          ? z.number().finite()
          : z.boolean();
    if (!schema.safeParse(value).success) throw new TypeError(`Invalid component prop: ${key}`);
    resolved[key] = value as string | number | boolean;
  }
  return resolved;
};

const sceneDataSchema = z.strictObject({
  id,
  owner: z.strictObject({ kind: z.literal("presentation") }),
  audience: z.strictObject({ kind: z.literal("all") }),
  parent: z.strictObject({ kind: z.literal("stage") }),
  physicalSizeMeters: z.tuple([positive, positive]),
  fit: z.literal("contain"),
  transform: z.strictObject({
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    rotation: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    scale: z.tuple([positive, positive, positive]),
  }),
  props: z.record(id, z.union([z.string(), z.number().finite(), z.boolean()])),
});

const staticSceneItemSchema = sceneDataSchema.extend({
  component: z.strictObject({ id, version: z.number().int().safe().positive() }),
});
export type StaticReactSceneItem = z.infer<typeof staticSceneItemSchema>;

export const validateStaticReactSceneItem = (value: unknown): StaticReactSceneItem =>
  staticSceneItemSchema.parse(snapshotDeclaration(value));

export const validateReactSceneItem = (value: unknown): string => {
  const fields = readOwnDataRecord(value);
  const component = fields.component;
  if (component === undefined) throw new TypeError("Scene item requires a component.");
  delete fields.component;
  const data = sceneDataSchema.parse(snapshotDeclaration(fields));
  resolveReactComponentProps(component, data.props);
  return data.id;
};

export const validateStaticComponentMetadata = (value: unknown): StaticComponentMetadata => {
  const metadata = metadataSchema.parse(snapshotDeclaration(value));
  const nodes = metadata.semantics.nodes;
  const roots = new Set(metadata.semantics.rootNodeIds);
  if (roots.size !== metadata.semantics.rootNodeIds.length)
    throw new TypeError("Duplicate semantic root.");
  for (const root of roots)
    if (!nodes[root] || nodes[root].parentId !== null)
      throw new TypeError("Invalid semantic root.");
  for (const [name, node] of Object.entries(nodes)) {
    if ((node.parentId === null) !== roots.has(name))
      throw new TypeError("Invalid semantic parent.");
    if (node.parentId !== null && !nodes[node.parentId])
      throw new TypeError("Unknown semantic parent.");
    if (typeof node.text !== "string" && metadata.props[node.text.name]?.kind !== "string")
      throw new TypeError("Text must reference a declared string prop.");
    if (node.role === "button" && !metadata.interactions?.[node.interactionId])
      throw new TypeError("Button interaction must be declared.");
  }
  const finiteFields = [
    metadata.interactions,
    metadata.initialState,
    metadata.states,
    metadata.actions,
    metadata.outputs,
  ];
  if (
    finiteFields.some((field) => field !== undefined) &&
    finiteFields.some((field) => field === undefined)
  )
    throw new TypeError(
      "Finite-state Component requires interactions, initialState, states, actions and outputs.",
    );
  if (metadata.states) {
    if (!metadata.initialState || !metadata.states[metadata.initialState])
      throw new TypeError("Unknown initial State.");
    for (const state of Object.values(metadata.states)) {
      const overrideIds = new Set<string>();
      const overriddenNodes = new Set<string>();
      for (const override of state.semanticOverrides) {
        if (
          !nodes[override.targetId] ||
          overrideIds.has(override.id) ||
          overriddenNodes.has(override.targetId) ||
          override.text === null ||
          override.alt === null
        )
          throw new TypeError("Invalid semantic override.");
        overrideIds.add(override.id);
        overriddenNodes.add(override.targetId);
      }
      const enabled = new Set(state.enabledInteractionIds);
      if (
        enabled.size !== state.enabledInteractionIds.length ||
        [...enabled].some((key) => !metadata.interactions?.[key])
      )
        throw new TypeError("Invalid enabled Interaction.");
    }
    for (const action of Object.values(metadata.actions ?? {}))
      for (const effect of action.effects)
        if (!metadata.states[effect.stateId]) throw new TypeError("Unknown Action target State.");
    for (const output of Object.values(metadata.outputs ?? {}))
      if (!metadata.interactions?.[output.producer.interactionId])
        throw new TypeError("Unknown Output Interaction.");
  }
  for (const name of Object.keys(nodes)) {
    const visited = new Set<string>();
    let current: string | null = name;
    while (current !== null) {
      if (visited.has(current)) throw new TypeError("Semantic tree contains a cycle.");
      visited.add(current);
      current = nodes[current]?.parentId ?? null;
    }
  }
  return metadata;
};

export const buildOpaqueComponentManifest = (
  metadata: StaticComponentMetadata,
  entry: string,
): Extract<ComponentManifest, { authoring: { mode: "opaque" } }> => {
  const valid = validateStaticComponentMetadata(metadata);
  const nodes = Object.fromEntries(
    Object.entries(valid.semantics.nodes)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, node]) => [
        key,
        {
          ...node,
          id: key,
          text:
            typeof node.text === "string"
              ? node.text
              : {
                  kind: "prop-ref" as const,
                  propId: node.text.name,
                  expectedType: "string" as const,
                },
        },
      ]),
  );
  const props = Object.fromEntries(
    Object.entries(valid.props).map(([key, declaration]) => {
      const { editor: _editor, ...propDeclaration } = declaration as typeof declaration & {
        editor?: { kind: "text" };
      };
      return [key, propDeclaration];
    }),
  );
  const bindingKeys = ["surface", ...Object.keys(nodes).map((key) => `node:${key}`)];
  return defineComponentManifest({
    componentId: valid.id,
    version: valid.version,
    props: props as Record<string, PropDeclaration>,
    slots: {},
    parts: {},
    variants: {},
    states: valid.states
      ? Object.fromEntries(
          Object.keys(valid.states).map((key) => [
            key,
            { kind: "state", ...(key === valid.initialState ? { initial: true } : {}) },
          ]),
        )
      : {},
    actions: valid.actions
      ? Object.fromEntries(
          Object.entries(valid.actions).map(([key, action]) => [
            key,
            {
              kind: "action",
              inputs: action.inputs,
              preconditions: action.preconditions,
              effects: action.effects.map((effect) => ({
                kind: "setSurfaceState",
                surfaceId: "surface",
                stateId: effect.stateId,
              })),
            },
          ]),
        )
      : {},
    outputs: valid.outputs
      ? Object.fromEntries(
          Object.entries(valid.outputs).map(([key, output]) => [
            key,
            { kind: "output", ...output } as OutputDeclaration,
          ]),
        )
      : {},
    authoring: { mode: "opaque" },
    renderers: { "baked-web": { entry, bindingKeys } },
    semantics: {
      targets: Object.keys(nodes).map((key) => ({
        id: key,
        kind: "node" as const,
        bindingKey: `node:${key}`,
      })),
      surfaces: [
        {
          id: "surface",
          bindingKey: "surface",
          baseSemanticTree: {
            rootNodeIds: valid.semantics.rootNodeIds,
            nodes: nodes as Record<string, SemanticNodeDeclaration>,
          },
          interactions: Object.fromEntries(
            Object.entries(valid.interactions ?? {}).map(([key, interaction]) => [
              key,
              { id: key, ...interaction },
            ]),
          ),
          initialStateId: valid.initialState ?? "default",
          states: valid.states
            ? Object.fromEntries(
                Object.entries(valid.states).map(([key, state]) => [
                  key,
                  {
                    id: key,
                    semanticOverrides: state.semanticOverrides.map((override) => ({
                      kind: "semantic-override",
                      ...override,
                    })),
                    enabledInteractionIds: state.enabledInteractionIds,
                  } as SurfaceStateDeclaration,
                ]),
              )
            : { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
        },
      ],
    },
  });
};
