import * as z from "zod";

const id = z.string().min(1);
const finite = z.number().finite();
const bounds = z.strictObject({ x: finite, y: finite, width: finite, height: finite });
export const rendererIdentitySchema = z.strictObject({
  id,
  version: id,
  contractVersion: id,
  implementationHash: id,
});
export const renderSurfacePlanSchema = z.strictObject({
  id,
  semanticSurfaceId: id,
  logicalBounds: bounds,
  layer: finite,
  ownership: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("structured"),
      ownedContentNodeIds: z.array(id),
      contextNodeIds: z.array(id),
    }),
    z.strictObject({ kind: z.literal("opaque"), bindingKeys: z.array(id) }),
  ]),
  clipWindow: bounds,
  states: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("capture") }),
      z.strictObject({ kind: z.literal("empty") }),
    ]),
  ),
});
type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type RendererIdentity = DeepReadonly<z.input<typeof rendererIdentitySchema>>;
export type RenderSurfacePlan = DeepReadonly<z.input<typeof renderSurfacePlanSchema>>;
