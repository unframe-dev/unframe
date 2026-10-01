import type { ReactElement } from "react";

export type PropDefinition<T, Required extends boolean = boolean> = {
  readonly kind: "prop";
  readonly __value?: T;
} & (Required extends true
  ? { readonly required: true; readonly default?: never }
  : { readonly default: T; readonly required?: never });
type AnyProp = PropDefinition<string | number | boolean>;
export declare function editableText(options: {
  required: true;
  default?: never;
}): PropDefinition<string, true>;
export declare function editableText(options: {
  default: string;
  required?: never;
}): PropDefinition<string, false>;
export declare function stringProp(options: {
  required: true;
  default?: never;
}): PropDefinition<string, true>;
export declare function stringProp(options: {
  default: string;
  required?: never;
}): PropDefinition<string, false>;
export declare function numberProp(options: {
  required: true;
  default?: never;
}): PropDefinition<number, true>;
export declare function numberProp(options: {
  default: number;
  required?: never;
}): PropDefinition<number, false>;
export declare function booleanProp(options: {
  required: true;
  default?: never;
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
  readonly role: "heading" | "paragraph" | "button";
  readonly level?: number;
  readonly parentId: string | null;
  readonly order: number;
  readonly text?: string | PropReference<string>;
  readonly interactionId?: string;
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
  | readonly SyncReactNode[];
type RenderContext<P, N, S> = {
  readonly props: ResolvedProps<P>;
  readonly texts: Readonly<Record<TextKeys<N>, string>>;
  readonly bindings: Readonly<Record<keyof N, Binding>>;
  readonly state: keyof S & string;
};
type StateDeclaration<N> = {
  readonly semanticOverrides: readonly {
    readonly id: string;
    readonly targetId: keyof N & string;
    readonly included: boolean;
  }[];
  readonly enabledInteractionIds: readonly string[];
};
export type SetStateEffect<K extends string> = { readonly kind: "setState"; readonly state: K };
export declare function setState<const K extends string>(state: K): SetStateEffect<K>;
type ValidateActions<A, S> = {
  readonly [K in keyof A]: A[K] extends { effects: readonly (infer E)[] }
    ? [E] extends [SetStateEffect<keyof S & string>]
      ? unknown
      : never
    : never;
};
type ActionDeclaration = {
  readonly inputs: object;
  readonly preconditions: readonly unknown[];
  readonly effects: readonly SetStateEffect<string>[];
};
type InteractionDeclaration = {
  readonly kind: "click";
  readonly event: string;
  readonly hitPriority: number;
};
type OutputDeclaration = {
  readonly payload: object;
  readonly producer: { readonly kind: "surfaceInteraction"; readonly interactionId: string };
};
export type Component<P, N, S, A, O> = {
  readonly id: string;
  readonly version: number;
  readonly __props?: P;
  readonly __nodes?: N;
  readonly __states?: S;
  readonly __actions?: A;
  readonly __outputs?: O;
};
type StateFields<N, S extends Record<string, StateDeclaration<N>>> =
  | { readonly states: S; readonly initialState: keyof S & string }
  | { readonly states?: never; readonly initialState?: never };
export declare function defineComponent<
  const P extends Record<string, AnyProp>,
  const N extends Record<string, SemanticNode>,
  const S extends Record<string, StateDeclaration<N>> = { default: StateDeclaration<N> },
  const A extends Record<string, ActionDeclaration> = {},
  const O extends Record<string, OutputDeclaration> = {},
>(
  value: {
    readonly id: string;
    readonly version: number;
    readonly props: P;
    readonly surface: { readonly logicalSize: readonly [number, number] };
    readonly semantics: {
      readonly rootNodeIds: readonly (keyof N & string)[];
      readonly nodes: N & ValidateNodes<P, N>;
    };
    readonly interactions?: Record<string, InteractionDeclaration>;
    readonly actions?: A & ValidateActions<A, S>;
    readonly outputs?: O;
    readonly render: (input: RenderContext<P, N, S>) => SyncReactNode;
  } & StateFields<N, S>,
): Component<P, N, S, A, O>;

type AnyComponent = Component<unknown, unknown, unknown, unknown, unknown>;
type ComponentProps<C> =
  C extends Component<infer P, unknown, unknown, unknown, unknown> ? InstanceProps<P> : never;
type SceneBase = {
  readonly id: string;
  readonly component: AnyComponent;
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
export declare function definePresentation<const S extends readonly SceneBase[]>(value: {
  readonly id: string;
  readonly metadata: { readonly title: string };
  readonly stage: {
    readonly coordinateSystem: {
      readonly unit: "meter";
      readonly handedness: "right";
      readonly upAxis: "+Y";
      readonly forwardAxis: "-Z";
    };
    readonly size: readonly [number, number, number];
  };
  readonly scene: S & CheckScene<S>;
  readonly assets: readonly unknown[];
  readonly flow: object;
  readonly operations: readonly unknown[];
}): { readonly scene: S };
