import type { ReactElement } from "react";
import { z } from "zod";
import type {
  ComponentManifest,
  PresentationDeclaration,
  PropDeclaration,
  SemanticNodeDeclaration,
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
type RenderContext<P, N> = {
  readonly props: ResolvedProps<P>;
  readonly texts: Readonly<Record<TextKeys<N>, string>>;
  readonly bindings: Readonly<Record<keyof N, Binding>>;
  readonly state: "default";
};
export type ReactComponent<P, N> = {
  readonly id: string;
  readonly version: number;
  readonly props: P;
  readonly surface: { readonly logicalSize: readonly [number, number] };
  readonly semantics: { readonly rootNodeIds: readonly (keyof N & string)[]; readonly nodes: N };
  readonly render: (input: RenderContext<P, N>) => SyncReactNode;
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

export const defineComponent = <
  const P extends Record<string, AnyProp>,
  const N extends Record<string, SemanticNode>,
>(value: {
  readonly id: string;
  readonly version: number;
  readonly props: P;
  readonly surface: { readonly logicalSize: readonly [number, number] };
  readonly semantics: {
    readonly rootNodeIds: readonly (keyof N & string)[];
    readonly nodes: N & ValidateNodes<P, N>;
  };
  readonly render: (input: RenderContext<P, N>) => SyncReactNode;
}): ReactComponent<P, N> => {
  validateRuntimeReactComponent(value);
  return value;
};

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
]);
const metadataSchema = z.strictObject({
  id,
  version: z.number().int().safe().positive(),
  props: z.record(id, propSchema),
  surface: z.strictObject({ logicalSize: z.tuple([positive, positive]) }),
  semantics: z.strictObject({ rootNodeIds: z.array(id), nodes: z.record(id, nodeSchema) }),
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
    Object.entries(valid.semantics.nodes).map(([key, node]) => [
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
    states: {},
    actions: {},
    outputs: {},
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
          interactions: {},
          initialStateId: "default",
          states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
        },
      ],
    },
  });
};
