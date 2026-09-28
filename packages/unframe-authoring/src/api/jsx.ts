import { z } from "zod";
import { snapshotDeclaration } from "../internal/declaration-validation.js";
import { componentInstance, frame, slotPlaceholder, surface, text } from "./definitions.js";
import type {
  FrameDeclaration,
  SurfaceDeclaration,
  TextDeclaration,
} from "../domain/declarations.js";
import type {
  AuthoringElement,
  ComponentInstanceProps,
  FrameProps,
  SlotProps,
  SurfaceProps,
  TextProps,
} from "../domain/jsx-input.js";

const propsSchema = z
  .record(z.string(), z.json())
  .refine((value) => !Object.hasOwn(value, "kind"), "JSX tags determine their declaration kind.");
const snapshotProps = <T>(props: T): T => {
  const snapshot = snapshotDeclaration(props);
  propsSchema.parse(snapshot);
  return snapshot as T;
};
const element = (value: unknown): AuthoringElement => value as AuthoringElement;

export const Frame = (props: FrameProps): AuthoringElement => {
  const { children, ...attributes } = snapshotProps(props);
  const items = children === undefined ? [] : Array.isArray(children) ? children : [children];
  return element(
    frame({ ...attributes, children: items.flat(Infinity) } as unknown as Omit<
      FrameDeclaration,
      "kind"
    >),
  );
};
export const Surface = (props: SurfaceProps): AuthoringElement => {
  const { children, ...attributes } = snapshotProps(props);
  if (Object.hasOwn(attributes, "root")) throw new TypeError("Surface uses its JSX child as root.");
  return element(
    surface({ ...attributes, root: children } as unknown as Omit<SurfaceDeclaration, "kind">),
  );
};
export const Text = (props: TextProps): AuthoringElement => {
  const attributes = snapshotProps(props);
  if (Object.hasOwn(attributes, "value") && Object.hasOwn(attributes, "children"))
    throw new TypeError("Text accepts either value or children, not both.");
  const { children, ...rest } = attributes;
  const value = Object.hasOwn(attributes, "value") ? attributes.value : children;
  return element(text({ ...rest, value } as Omit<TextDeclaration, "kind">));
};
export const Slot = (props: SlotProps): AuthoringElement =>
  element(slotPlaceholder(snapshotProps(props)));
export const ComponentInstance = (props: ComponentInstanceProps): AuthoringElement =>
  element(componentInstance(snapshotProps(props)));
