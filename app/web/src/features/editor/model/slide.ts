import { z } from "zod";
import { ElementSchema } from "./element";

export const SlideSchema = z.object({
  elements: z.array(ElementSchema),
  id: z.string().min(1),
  name: z.string().min(1),
});

export type Slide = z.infer<typeof SlideSchema>;
