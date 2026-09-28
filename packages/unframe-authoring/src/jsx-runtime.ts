import { ComponentInstance, Frame, Slot, Surface, Text } from "./api/jsx.js";
import type {
  AuthoringElement,
  ComponentInstanceProps,
  FrameProps,
  SlotProps,
  SurfaceProps,
  TextProps,
} from "./domain/jsx-input.js";

export namespace JSX {
  export type Element = AuthoringElement;
  export type ElementType =
    | typeof ComponentInstance
    | typeof Frame
    | typeof Slot
    | typeof Surface
    | typeof Text;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicElements {}
}

export const jsx = (tag: unknown, props: unknown, key?: unknown): AuthoringElement => {
  if (key !== undefined)
    throw new TypeError("Authoring JSX uses explicit declaration IDs instead of keys.");
  if (tag === Frame) return Frame(props as FrameProps);
  if (tag === Surface) return Surface(props as SurfaceProps);
  if (tag === Text) return Text(props as TextProps);
  if (tag === Slot) return Slot(props as SlotProps);
  if (tag === ComponentInstance) return ComponentInstance(props as ComponentInstanceProps);
  throw new TypeError("Only SDK Authoring JSX tags are supported.");
};
export { jsx as jsxs };
