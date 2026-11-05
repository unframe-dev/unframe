import * as z from "zod";
import {
  idSchema,
  positiveSafeUIntSchema,
  resourceOwnerSchema,
  srgbaColorSchema,
  uint32Schema,
} from "./common";

const positiveFloat32Schema = z
  .number()
  .finite()
  .min(2 ** -149)
  .max(3.4028234663852886e38);

const settings = {
  size: positiveFloat32Schema,
  color: srgbaColorSchema,
  speed: positiveFloat32Schema,
  durationMilliseconds: positiveSafeUIntSchema,
};
export const effectConfigurationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...settings,
    kind: z.literal("wave"),
    waveCycles: z.number().finite().min(0).max(6),
  }),
  z.strictObject({ ...settings, kind: z.literal("handGlow"), hand: z.enum(["left", "right"]) }),
  z.strictObject({ ...settings, kind: z.literal("dissolve") }),
]);
export const effectStartActionSchema = z.strictObject({
  kind: z.literal("effect.start"),
  effectId: idSchema,
  nodeId: idSchema,
  effect: effectConfigurationSchema,
  owner: resourceOwnerSchema,
  seed: uint32Schema,
});
export const effectStopActionSchema = z.strictObject({
  kind: z.literal("effect.stop"),
  effectId: idSchema,
});
export type EffectConfiguration = z.infer<typeof effectConfigurationSchema>;
export type EffectStartAction = z.infer<typeof effectStartActionSchema>;
export type EffectStopAction = z.infer<typeof effectStopActionSchema>;
