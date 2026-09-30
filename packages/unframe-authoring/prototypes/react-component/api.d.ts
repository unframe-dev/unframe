import type { ReactElement } from "react";

export type PropDefinition<T, Required extends boolean = boolean> = {
  readonly __value?: T;
  readonly kind: "prop";
} & (Required extends true
  ? { readonly default?: never; readonly required: true }
  : { readonly default: T; readonly required?: never });
type AnyProp = PropDefinition<string | number | boolean>;
export declare function editableText(options: {
  default?: never;
  required: true;
}): PropDefinition<string, true>;
export declare function editableText(options: {
  default: string;
  required?: never;
}): PropDefinition<string, false>;
export declare function stringProp(options: {
  default?: never;
  required: true;
}): PropDefinition<string, true>;
export declare function stringProp(options: {
  default: string;
  required?: never;
}): PropDefinition<string, false>;
export declare function numberProp(options: {
  default?: never;
  required: true;
}): PropDefinition<number, true>;
export declare function numberProp(options: {
  default: number;
  required?: never;
}): PropDefinition<number, false>;
export declare function booleanProp(options: {
  default?: never;
  required: true;
}): PropDefinition<boolean, true>;
export declare function booleanProp(options: {
  default: boolean;
  required?: never;
}): PropDefinition<boolean, false>;

type PropValue<D> = D extends PropDefinition<infer T> ? T : never;
type RequiredKeys<P> = { [K in keyof P]: P[K] extends { required: true } ? K : never }[keyof P];
export type InstanceProps<P> = { readonly [K in RequiredKeys<P>]: PropValue<P[K]> } & {
  readonly [K in Exclude<keyof P, RequiredKeys<P>>]?: PropValue<P[K]>;
};
type ResolvedProps<P> = { readonly [K in keyof P]-?: PropValue<P[K]> };
type StringKeys<P> = { [K in keyof P]: PropValue<P[K]> extends string ? K : never }[keyof P] &
  string;
export type PropReference<K extends string> = { readonly kind: "prop-ref"; readonly name: K };
export declare function prop<const K extends string>(name: K): PropReference<K>;

type SemanticNode = {
  readonly interactionId?: string;
  readonly level?: number;
  readonly order: number;
  readonly parentId: string | null;
  readonly role: "heading" | "paragraph" | "button";
  readonly text?: string | PropReference<string>;
};
type ValidateNode<P, N> = N extends { text: PropReference<infer K> }
  ? K extends StringKeys<P>
    ? unknown
    : never
  : unknown;
type ValidateNodes<P, N> = { readonly [K in keyof N]: ValidateNode<P, N[K]> };
type TextKeys<N> = {
  [K in keyof N]: N[K] extends { text: string | PropReference<string> } ? K : never;
}[keyof N] &
  string;
type Binding = { readonly [attribute: `data-unframe-${string}`]: string };
type SyncReactNode =
  | ReactElement
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ReadonlyArray<SyncReactNode>;
type RenderContext<P, N, S> = {
  readonly bindings: Readonly<Record<keyof N, Binding>>;
  readonly props: ResolvedProps<P>;
  readonly state: keyof S & string;
  readonly texts: Readonly<Record<TextKeys<N>, string>>;
};
type StateDeclaration<N> = {
  readonly enabledInteractionIds: ReadonlyArray<string>;
  readonly semanticOverrides: ReadonlyArray<{
    readonly id: string;
    readonly targetId: keyof N & string;
    readonly included: boolean;
  }>;
};
export type SetStateEffect<K extends string> = { readonly kind: "setState"; readonly state: K };
export declare function setState<const K extends string>(state: K): SetStateEffect<K>;
type ValidateActions<A, S> = {
  readonly [K in keyof A]: A[K] extends { effects: ReadonlyArray<infer E> }
    ? [E] extends [SetStateEffect<keyof S & string>]
      ? unknown
      : never
    : never;
};
type ActionDeclaration = {
  readonly effects: ReadonlyArray<SetStateEffect<string>>;
  readonly inputs: object;
  readonly preconditions: ReadonlyArray<unknown>;
};
type InteractionDeclaration = {
  readonly event: string;
  readonly hitPriority: number;
  readonly kind: "click";
};
type OutputDeclaration = {
  readonly payload: object;
  readonly producer: { readonly interactionId: string; readonly kind: "surfaceInteraction" };
};
export type Component<P, N, S, A, O> = {
  readonly __actions?: A;
  readonly __nodes?: N;
  readonly __outputs?: O;
  readonly __props?: P;
  readonly __states?: S;
  readonly id: string;
  readonly version: number;
};
type StateFields<N, S extends Record<string, StateDeclaration<N>>> =
  | { readonly initialState: keyof S & string; readonly states: S }
  | { readonly initialState?: never; readonly states?: never };
export declare function defineComponent<
  const P extends Record<string, AnyProp>,
  const N extends Record<string, SemanticNode>,
  const S extends Record<string, StateDeclaration<N>> = { default: StateDeclaration<N> },
  const A extends Record<string, ActionDeclaration> = {},
  const O extends Record<string, OutputDeclaration> = {},
>(
  value: {
    readonly actions?: A & ValidateActions<A, S>;
    readonly id: string;
    readonly interactions?: Record<string, InteractionDeclaration>;
    readonly outputs?: O;
    readonly props: P;
    readonly render: (input: RenderContext<P, N, S>) => SyncReactNode;
    readonly semantics: {
      readonly nodes: N & ValidateNodes<P, N>;
      readonly rootNodeIds: readonly (keyof N & string)[];
    };
    readonly surface: { readonly logicalSize: readonly [number, number] };
    readonly version: number;
  } & StateFields<N, S>,
): Component<P, N, S, A, O>;

type AnyComponent = Component<unknown, unknown, unknown, unknown, unknown>;
type ComponentProps<C> =
  C extends Component<infer P, unknown, unknown, unknown, unknown> ? InstanceProps<P> : never;
type SceneBase = {
  readonly audience: { readonly kind: "all" };
  readonly component: AnyComponent;
  readonly fit: "contain";
  readonly id: string;
  readonly owner: { readonly kind: "presentation" };
  readonly parent: { readonly kind: "stage" };
  readonly physicalSizeMeters: readonly [number, number];
  readonly props: object;
  readonly transform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
  };
};
type CheckSceneItem<I> = I extends { component: infer C; props: infer Actual }
  ? C extends AnyComponent
    ? Actual extends ComponentProps<C>
      ? Exclude<keyof Actual, keyof ComponentProps<C>> extends never
        ? unknown
        : never
      : never
    : never
  : never;
type CheckScene<S> = { readonly [K in keyof S]: S[K] & CheckSceneItem<S[K]> };
export declare function definePresentation<const S extends ReadonlyArray<SceneBase>>(value: {
  readonly assets: ReadonlyArray<unknown>;
  readonly flow: object;
  readonly id: string;
  readonly metadata: { readonly title: string };
  readonly operations: ReadonlyArray<unknown>;
  readonly scene: S & CheckScene<S>;
  readonly stage: {
    readonly coordinateSystem: {
      readonly forwardAxis: "-Z";
      readonly handedness: "right";
      readonly unit: "meter";
      readonly upAxis: "+Y";
    };
    readonly size: readonly [number, number, number];
  };
}): { readonly scene: S };
