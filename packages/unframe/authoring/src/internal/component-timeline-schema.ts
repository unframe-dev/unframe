import { z } from "zod";

const finite = z.number().finite();
const nonNegativeInteger = finite.int().nonnegative().safe();

export const componentTimelineSchema = z.strictObject({
  id: z.string().min(1),
  source: z
    .strictObject({
      file: z.string().min(1),
      range: z
        .tuple([nonNegativeInteger, nonNegativeInteger])
        .refine(([start, end]) => start <= end)
        .optional(),
    })
    .optional(),
  durationMilliseconds: finite.int().positive().safe(),
  tracks: z
    .array(
      z.strictObject({
        target: z.strictObject({
          kind: z.literal("host"),
          property: z.enum([
            "opacity",
            "transform.position",
            "transform.rotation",
            "transform.scale",
          ]),
        }),
        keyframes: z
          .array(
            z.strictObject({
              timeMilliseconds: nonNegativeInteger,
              value: z.union([
                finite,
                z.tuple([finite, finite, finite]),
                z.tuple([finite, finite, finite, finite]),
              ]),
              easingToNext: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]).optional(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});
