import { Button as Primitive } from "@base-ui/react/button";
import type { ComponentProps } from "react";
export function Button({ className = "", ...props }: ComponentProps<typeof Primitive>) {
  return <Primitive {...props} className={`button ${className}`} />;
}
