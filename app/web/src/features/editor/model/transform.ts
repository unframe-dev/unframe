import { z } from "zod";

const finiteNumber = z.number().finite();
const positiveFiniteNumber = finiteNumber.positive({
  message: "Scale components must be greater than zero",
});

export const Vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);

export const QuaternionSchema = z
  .tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
  .superRefine((rotation, context) => {
    const magnitude = Math.hypot(...rotation);
    if (Math.abs(magnitude - 1) > 0.0001) {
      context.addIssue({
        code: "custom",
        message: "Quaternion must be normalized and ordered as [x, y, z, w]",
      });
    }
  });

export const Scale3Schema = z.tuple([
  positiveFiniteNumber,
  positiveFiniteNumber,
  positiveFiniteNumber,
]);

export const TransformSchema = z.object({
  position: Vector3Schema,
  rotation: QuaternionSchema,
  scale: Scale3Schema,
});

export type Transform = z.infer<typeof TransformSchema>;
