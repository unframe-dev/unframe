import { z } from "zod";
import { ElementSchema } from "./element";

export const SlideSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  elements: z.array(ElementSchema),
});

export type Slide = z.infer<typeof SlideSchema>;
